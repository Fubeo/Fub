import "./style.css";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  api,
  onKernelEvent,
  type CommandEffect,
  type CommandSpec,
  type KernelEvent,
  type PaneMode,
  type SearchHit,
  type Span,
  type UiNode,
  type ViewContext,
  type ViewSpec,
  type ViewUpdate,
  type WorkspaceMeta,
} from "./api";
import { createEditor, type Editor } from "./editor";
import {
  allFolders,
  buildTree,
  childName,
  findFolder,
  folderNoteOf,
  orderedNames,
  pageName,
  parentOf,
  type FolderNode,
} from "./organizer";
import { renderUiNode } from "./ui";
import { openGraph } from "./graph";
import { findByBinding, openCommandPalette, startCommand } from "./palette";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const fileListEl = $("#file-list");
const previewEl = $("#preview");
const viewsLeftEl = $("#views-left");
const viewsRightEl = $("#views-right");
const viewsBottomEl = $("#views-bottom");
const vaultPathEl = $("#vault-path");
const searchInputEl = $<HTMLInputElement>("#search-input");
const searchPanelEl = $("#search-panel");
const searchSummaryEl = $("#search-summary");
const searchResultsEl = $("#search-results");
const filesPanelEl = $("#files-panel");
const trashPanelEl = $("#trash-panel");
const trashListEl = $("#trash-list");
const historyPanelEl = $("#history-panel");
const historyListEl = $("#history-list");
const historySummaryEl = $("#history-summary");
const historyPreviewEl = $("#history-preview");
const filesTitleEl = $("#files-title");
const spaceStripEl = $("#space-strip");
const spaceTitleEl = $("#space-title");
const pinnedTitleEl = $("#pinned-title");
const pinnedListEl = $("#pinned-list");

let currentDoc: string | null = null;
// L'ultima lista di documenti disegnata: serve a ridisegnare la sidebar senza
// richiederla al kernel a ogni ritocco dell'organizzazione. Non è una verità,
// è un'eco — chi crea o rinomina passa comunque dal kernel.
let knownDocs: string[] = [];
let editor: Editor;
let saveTimer: number | undefined;
let searchTimer: number | undefined;
// Ogni ricerca porta il proprio numero d'ordine: una risposta lenta di una
// query vecchia non deve sovrascrivere i risultati di una più recente.
let searchSeq = 0;
// Le estensioni che i provider registrati del backend gestiscono: quali siano
// lo sanno i `FormatDescriptor`, non la UI — e markdown è il primo formato, non
// l'unico. Servono a riconoscere una folder note (`X/X.<ext>`, `index.<ext>`).
let handledExtensions: string[] = ["md"];
// Il versioning è acceso in questa sessione? Spento significa assente (D7):
// il pannello della cronologia non esiste, e non si interroga.
let versioningOn = false;
// Il buffer ha modifiche non ancora scritte su disco? Finché è sporco, il
// buffer è la verità del documento aperto (vedi docs/architecture/data-model.md,
// "Fonte di verità"): non va MAI sovrascritto da un reload.
let dirty = false;
// L'organizzazione del vault (icone, appuntate, ordinamenti, spazi): il
// sidecar `.fubmd/workspace.json`. Autorevole, non derivato.
let meta: WorkspaceMeta = { icons: {}, pinned: [], order: {}, spaces: [] };
// Un sidecar illeggibile congela l'organizzazione: si lavora col default ma
// non si salva, perché salvare sovrascriverebbe ciò che l'utente ha già.
let metaBroken = false;
let vaultRoot = "";
// Cartelle aperte nell'albero: stato di vista per-macchina (localStorage),
// non nel sidecar — su un altro dispositivo è solo rumore.
let expanded = new Set<string>();
// Lo spazio selezionato nella striscia (null = "home", tutto il vault).
// Anche questo è vista, non organizzazione: localStorage, come `expanded`.
let activeSpace: string | null = null;
// I comandi dichiarati dal kernel, per le scorciatoie: quali esistano lo dice
// il registro (`list_commands`), non questa shell. La palette li richiede da
// sé quando si apre — qui servono a riconoscere una combinazione di tasti
// senza un giro sull'IPC a ogni pressione.
let commandSpecs: CommandSpec[] = [];
// Il drag in corso nella sidebar, se c'è.
let drag: { path: string; kind: "note" | "folder"; parent: string } | null = null;
// La modalità del pannello (FEATURES 4.1). Questa shell ha un pannello solo —
// il contesto che pubblica ne porta comunque l'identità, perché con gli split
// (3.3) la stessa domanda avrà due risposte. È **stato di vista**, come le
// cartelle aperte e lo spazio selezionato: sta in localStorage, non nel
// sidecar del vault, perché "come sto guardando questa nota adesso" è di
// questa macchina e su un'altra sarebbe solo rumore.
const MODE_KEY = "fubmd.mode";
let mode: PaneMode = loadMode();
// Pubblicazione del contesto: la selezione si muove a ogni tasto, il kernel non
// deve saperlo a ogni tasto.
let contextTimer: number | undefined;

/// L'unico pannello di questa shell. Deve coincidere col `MAIN_PANE` del
/// kernel: un pannello con un altro nome è, da contratto, un altro pannello.
const MAIN_PANE = "main";

/// La modalità dell'ultima sessione, se ne resta traccia. Sta accanto alla
/// costante che legge — una `const` dichiarata più in basso nel modulo sarebbe
/// in temporal dead zone quando questa gira, e il modulo non partirebbe
/// affatto (nessun errore in console: proprio niente).
function loadMode(): PaneMode {
  const salvata = localStorage.getItem(MODE_KEY);
  return salvata === "source" || salvata === "reading" || salvata === "live_preview"
    ? salvata
    : "live_preview";
}

async function init() {
  editor = createEditor($("#editor"), {
    onChange: () => {
      dirty = true;
      scheduleSave();
    },
    // Il cursore si è mosso (o il testo è cambiato sotto di lui): il contesto
    // di sessione è invecchiato. Non si pubblica subito — vedi
    // `scheduleContext`.
    onSelectionChange: scheduleContext,
    // Mod-click su un wikilink nella live preview: stesso giro dei link
    // dell'anteprima (risolvi, altrimenti crea la nota che manca).
    onOpenWikilink: openWikilinkFromEditor,
    // Click su un #tag: stessa query canonica del pannello tag.
    onSearchTag: (tag) => searchFor(`tags:${tag}`),
    // Le sorgenti dei completamenti sono l'IPC, ammorbidite: prima che un
    // vault sia aperto rispondono vuoto, non con un errore in console.
    completions: {
      listNotes: () => api.listDocuments().catch(() => []),
      listTags: () => api.listTags().catch(() => []),
    },
  });
  $("#open-vault").addEventListener("click", pickVault);
  $("#new-note").addEventListener("click", () => newNote());
  spaceTitleEl.addEventListener("click", openSpaceNote);
  wireRootDropTarget();
  $("#show-trash").addEventListener("click", openTrash);
  $("#show-graph").addEventListener("click", () => openGraph(currentDoc, selectDoc));
  for (const b of document.querySelectorAll<HTMLElement>("#mode-switch button")) {
    b.addEventListener("click", () => setMode(b.dataset.mode as PaneMode));
  }
  $("#close-trash").addEventListener("click", () => showPanel("files"));
  $("#empty-trash").addEventListener("click", emptyTrash);
  searchInputEl.addEventListener("input", scheduleSearch);
  searchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearSearch();
  });
  // La tastiera dei comandi, in un punto solo: la palette, e le scorciatoie
  // che i comandi **dichiarano**. La shell non ne cabla nessuna — se un domani
  // un plugin dichiara `Mod-Shift-t`, funziona senza toccare questo file.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      void openCommandPalette(paletteHost);
      return;
    }
    const spec = findByBinding(commandSpecs, e);
    if (spec) {
      e.preventDefault();
      startCommand(spec, paletteHost);
    }
  });
  onKernelEvent(handleKernelEvent);
  document.body.dataset.mode = mode;
  const initial = await api.initialVault();
  if (initial) await openVaultPath(initial);
  // La modalità iniziale passa dalla stessa porta di un click sul commutatore
  // — il cablaggio (classe attiva, resa inline, superficie di lettura,
  // contesto pubblicato) sta in un punto solo invece che in due che devono
  // restare d'accordo. Dopo l'apertura del vault, non prima: il contesto si
  // pubblica quando c'è un workspace a cui pubblicarlo.
  await setMode(mode);
}

async function pickVault() {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir === "string") await openVaultPath(dir);
}

async function openVaultPath(dir: string) {
  const info = await api.openVault(dir);
  vaultPathEl.textContent = info.root;
  vaultRoot = info.root;
  handledExtensions = info.extensions.length > 0 ? info.extensions : handledExtensions;
  versioningOn = info.versioning;
  historyPanelEl.hidden = !versioningOn;
  try {
    meta = await api.readWorkspaceMeta();
    metaBroken = false;
  } catch (e) {
    console.error(`FubMD: organizzazione del vault illeggibile, la congelo: ${e}`);
    meta = { icons: {}, pinned: [], order: {}, spaces: [] };
    metaBroken = true;
  }
  loadExpanded();
  loadActiveSpace();
  currentDoc = null;
  editor.setDoc("");
  previewEl.innerHTML = "";
  clearSearch();
  renderFileList(info.documents);
  // Le view dichiarative si scoprono dal backend, non da id cablati. E come le
  // view, i comandi: l'elenco serve alle scorciatoie dichiarate: la palette lo
  // richiede da sé a ogni apertura, perché è il momento in cui costa nulla ed è
  // l'unico in cui deve essere fresco.
  await mountDeclaredViews();
  commandSpecs = await api.listCommands().catch(() => []);
  if (info.documents.length > 0) selectDoc(info.documents[0]);
}

function renderFileList(docs: string[]) {
  knownDocs = docs;
  // Uno spazio rimosso (o la cui cartella non esiste più) non può restare
  // selezionato: si torna a casa senza dire niente.
  if (activeSpace !== null && !meta.spaces.includes(activeSpace)) {
    activeSpace = null;
    saveActiveSpace();
  }
  renderSpaceStrip();
  renderSpaceTitle();
  renderPinned(docs);
  fileListEl.innerHTML = "";
  renderChildren(buildTree(docs, meta, activeSpace ?? ""), fileListEl);
}

/// I figli di una cartella, ricorsivamente: prima le sottocartelle (col loro
/// sottoalbero, se aperte), poi le note. La folder note non compare tra i
/// figli: è la cartella stessa, e la apre il click sulla sua riga.
function renderChildren(node: FolderNode, ul: HTMLElement) {
  for (const sub of node.folders) {
    const li = document.createElement("li");
    li.appendChild(folderRow(sub));
    if (expanded.has(sub.path)) {
      const nested = document.createElement("ul");
      nested.className = "tree-children";
      renderChildren(sub, nested);
      li.appendChild(nested);
    }
    ul.appendChild(li);
  }
  const fnote = folderNoteOf(node, handledExtensions);
  for (const id of node.notes) {
    if (id === fnote) continue;
    const li = document.createElement("li");
    li.appendChild(noteRow(id, { draggable: true }));
    ul.appendChild(li);
  }
}

/// La riga di una nota, usata sia nell'albero sia tra le appuntate (dove il
/// drag non ha senso: l'ordine delle appuntate è l'ordine in cui si appunta).
function noteRow(id: string, opts: { draggable: boolean }): HTMLElement {
  const row = document.createElement("div");
  row.className = "row note" + (id === currentDoc ? " active" : "");
  row.title = id;
  const icon = meta.icons[id];
  if (icon) row.appendChild(rowIcon(icon));
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = pageName(id);
  row.appendChild(name);

  row.addEventListener("click", () => selectDoc(id));
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const appuntata = meta.pinned.includes(id);
    showContextMenu(e, [
      { label: "Rinomina", run: () => startRename(row, id) },
      { label: "Icona…", run: () => pickIcon(e, id) },
      { label: appuntata ? "Togli dalle appuntate" : "Appunta", run: () => togglePin(id) },
      { label: "Converti in cartella", run: () => convertToFolder(id) },
      { label: "Elimina", danger: true, run: () => deleteDoc(id) },
    ]);
  });
  if (opts.draggable) wireDrag(row, id, "note");
  return row;
}

/// La riga di una cartella: freccia per aprire/chiudere, click che apre la
/// folder note se c'è (altrimenti apre/chiude, come la freccia).
function folderRow(folder: FolderNode): HTMLElement {
  const row = document.createElement("div");
  row.className = "row folder";
  row.title = folder.path;

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = expanded.has(folder.path) ? "▾" : "▸";
  chevron.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFolder(folder.path);
  });
  row.appendChild(chevron);
  row.appendChild(rowIcon(meta.icons[folder.path] ?? "📁"));

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = folder.name;
  row.appendChild(name);

  const fnote = folderNoteOf(folder, handledExtensions);
  if (fnote) row.classList.add("has-note");
  row.addEventListener("click", () => {
    if (fnote) {
      selectDoc(fnote);
      if (!expanded.has(folder.path)) toggleFolder(folder.path);
    } else {
      toggleFolder(folder.path);
    }
  });
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e, [
      { label: "Icona…", run: () => pickIcon(e, folder.path) },
      { label: "Usa come spazio", run: () => addSpace(folder.path) },
    ]);
  });
  wireDrag(row, folder.path, "folder");
  return row;
}

function rowIcon(icon: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "row-icon";
  span.textContent = icon;
  return span;
}

function toggleFolder(path: string) {
  if (!expanded.delete(path)) expanded.add(path);
  saveExpanded();
  renderFileList(knownDocs);
}

/// Ricostruire la lista distrugge gli `<li>`: un click a cavallo del rebuild
/// (mousedown sul vecchio nodo, mouseup su quello nuovo) non produce nessun
/// `click` e all'utente sembra servire un doppio click. Gli eventi del kernel
/// arrivano a ogni salvataggio con una lista quasi sempre identica: qui si
/// ricostruisce solo se è cambiata davvero.
function refreshFileList(docs: string[]) {
  const uguale =
    docs.length === knownDocs.length && docs.every((d, i) => d === knownDocs[i]);
  if (!uguale) renderFileList(docs);
}

// --- appuntate, icone, spazio ----------------------------------------------

function renderPinned(docs: string[]) {
  const presenti = new Set(docs);
  const pinned = meta.pinned.filter((id) => presenti.has(id));
  pinnedTitleEl.hidden = pinned.length === 0;
  pinnedListEl.hidden = pinned.length === 0;
  pinnedListEl.innerHTML = "";
  for (const id of pinned) {
    const li = document.createElement("li");
    li.appendChild(noteRow(id, { draggable: false }));
    pinnedListEl.appendChild(li);
  }
}

function togglePin(id: string) {
  const i = meta.pinned.indexOf(id);
  if (i === -1) meta.pinned.push(id);
  else meta.pinned.splice(i, 1);
  saveMeta();
  renderFileList(knownDocs);
}

// Uno spazio è una cartella registrata nella striscia di icone in cima alla
// sidebar (stile make.md): selezionarlo radica l'albero lì, e il resto del
// vault non esiste. La prima icona è "home", cioè il vault intero.

function renderSpaceStrip() {
  spaceStripEl.innerHTML = "";

  const home = document.createElement("button");
  home.className = "space-chip" + (activeSpace === null ? " active" : "");
  home.textContent = "🏠";
  home.title = "Tutto il vault";
  home.addEventListener("click", () => selectSpace(null));
  spaceStripEl.appendChild(home);

  for (const path of meta.spaces) {
    const chip = document.createElement("button");
    chip.className = "space-chip" + (activeSpace === path ? " active" : "");
    chip.textContent = meta.icons[path] ?? "🗂️";
    chip.title = childName(path);
    chip.addEventListener("click", () => selectSpace(path));
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: "Icona…", run: () => pickIcon(e, path) },
        { label: "Togli dagli spazi", run: () => removeSpace(path) },
      ]);
    });
    spaceStripEl.appendChild(chip);
  }

  const add = document.createElement("button");
  add.className = "space-chip add";
  add.textContent = "+";
  add.title = "Nuovo spazio da una cartella";
  add.addEventListener("click", (e) => pickNewSpace(e));
  spaceStripEl.appendChild(add);
}

/// Il titolo del pannello: il nome dello spazio attivo (cliccarlo apre la sua
/// folder note), o "Note" a casa.
function renderSpaceTitle() {
  spaceTitleEl.textContent =
    activeSpace === null
      ? "Note"
      : `${meta.icons[activeSpace] ?? "🗂️"} ${childName(activeSpace)}`;
  spaceTitleEl.classList.toggle("clickable", activeSpace !== null);
}

function selectSpace(path: string | null) {
  activeSpace = path;
  saveActiveSpace();
  renderFileList(knownDocs);
}

/// Registra una cartella come spazio (se già non lo è) e la seleziona.
function addSpace(path: string) {
  if (!meta.spaces.includes(path)) {
    meta.spaces.push(path);
    saveMeta();
  }
  selectSpace(path);
}

/// Toglie lo spazio dalla striscia. La cartella e le note restano dove sono:
/// uno spazio è solo un punto di vista, non un contenitore.
function removeSpace(path: string) {
  const i = meta.spaces.indexOf(path);
  if (i === -1) return;
  meta.spaces.splice(i, 1);
  saveMeta();
  if (activeSpace === path) activeSpace = null;
  saveActiveSpace();
  renderFileList(knownDocs);
}

/// Il "+" della striscia: un menu con le cartelle del vault non ancora spazi.
function pickNewSpace(at: MouseEvent) {
  const candidate = allFolders(buildTree(knownDocs, meta)).filter(
    (f) => !meta.spaces.includes(f.path),
  );
  if (candidate.length === 0) {
    showContextMenu(at, [{ label: "Nessuna cartella disponibile", run: () => {} }]);
    return;
  }
  showContextMenu(
    at,
    candidate.map((f) => ({
      label: `${meta.icons[f.path] ?? "📁"} ${f.path}`,
      run: () => addSpace(f.path),
    })),
  );
}

/// Il nome dello spazio nel titolo apre la sua folder note, se esiste.
function openSpaceNote() {
  if (activeSpace === null) return;
  const node = findFolder(buildTree(knownDocs, meta), activeSpace);
  const fnote = node && folderNoteOf(node, handledExtensions);
  if (fnote) selectDoc(fnote);
}

function activeSpaceKey(): string {
  return `fubmd:space:${vaultRoot}`;
}

function loadActiveSpace() {
  activeSpace = localStorage.getItem(activeSpaceKey());
}

function saveActiveSpace() {
  if (activeSpace === null) localStorage.removeItem(activeSpaceKey());
  else localStorage.setItem(activeSpaceKey(), activeSpace);
}

const ICON_PRESETS = [
  "📝", "📁", "🗂️", "📌", "⭐", "🔥", "💡", "📚", "🎯", "✅",
  "🧠", "🛠️", "🎨", "🎵", "🏠", "💼", "🌱", "✈️", "❤️", "🧪",
];

/// Un piccolo selettore accanto al punto del click: qualche emoji pronta, un
/// campo per incollarne una qualsiasi, e il ritorno a "senza icona".
function pickIcon(at: MouseEvent, path: string) {
  document.getElementById("icon-picker")?.remove();
  const pop = document.createElement("div");
  pop.id = "icon-picker";
  pop.style.left = `${Math.min(at.clientX, window.innerWidth - 240)}px`;
  pop.style.top = `${at.clientY}px`;

  const chiudi = () => {
    pop.remove();
    document.removeEventListener("mousedown", fuori, true);
  };
  const fuori = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) chiudi();
  };
  const applica = (icon: string | null) => {
    if (icon) meta.icons[path] = icon;
    else delete meta.icons[path];
    saveMeta();
    chiudi();
    renderFileList(knownDocs);
  };

  const grid = document.createElement("div");
  grid.className = "icon-grid";
  for (const emoji of ICON_PRESETS) {
    const b = document.createElement("button");
    b.textContent = emoji;
    b.addEventListener("click", () => applica(emoji));
    grid.appendChild(b);
  }
  pop.appendChild(grid);

  const input = document.createElement("input");
  input.placeholder = "un'emoji qualsiasi…";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) applica(input.value.trim());
    else if (e.key === "Escape") chiudi();
  });
  pop.appendChild(input);

  const rimuovi = document.createElement("button");
  rimuovi.className = "icon-none";
  rimuovi.textContent = "Senza icona";
  rimuovi.addEventListener("click", () => applica(null));
  pop.appendChild(rimuovi);

  document.body.appendChild(pop);
  input.focus();
  document.addEventListener("mousedown", fuori, true);
}

/// `p/X.md` → `p/X/X.md`: la nota diventa la folder note di una cartella nuova
/// col suo nome. I wikilink entranti li riscrive il rename del kernel; icona e
/// pin migrano sull'evento `document_renamed`, come per ogni rename.
///
/// L'estensione non si sceglie: è quella che la nota ha già (`childName`). Prima
/// era `.md` cablata, che avrebbe cambiato formato a una nota per il solo fatto
/// di spostarla in una cartella.
async function convertToFolder(id: string) {
  const stem = pageName(id);
  const dir = parentOf(id);
  const folderPath = dir ? `${dir}/${stem}` : stem;
  try {
    await api.renameDocument(id, `${folderPath}/${childName(id)}`);
  } catch (e) {
    console.error(`FubMD: non riesco a convertire ${id} in cartella: ${e}`);
    return;
  }
  expanded.add(folderPath);
  saveExpanded();
  renderFileList(await api.listDocuments());
}

// --- drag & drop nella sidebar ---------------------------------------------
//
// Due gesti: riordinare tra fratelli dello stesso tipo (l'ordine finisce in
// `meta.order`, per cartella) e trascinare una nota SU una cartella per
// spostarcela dentro (che è un rename: il kernel sposta il file e riscrive i
// wikilink). Le cartelle non si spostano: sarebbero N rename, un'operazione
// che merita di più di un gesto ambiguo.

function wireDrag(row: HTMLElement, path: string, kind: "note" | "folder") {
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    drag = { path, kind, parent: parentOf(path) };
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", path);
  });
  row.addEventListener("dragend", () => {
    drag = null;
    clearDropMarks();
  });
  row.addEventListener("dragover", (e) => {
    const gesto = dropGesture(row, path, kind, e);
    if (!gesto) return;
    e.preventDefault();
    clearDropMarks();
    row.classList.add(`drop-${gesto}`);
  });
  row.addEventListener("dragleave", () => {
    row.classList.remove("drop-before", "drop-after", "drop-into");
  });
  row.addEventListener("drop", async (e) => {
    const gesto = dropGesture(row, path, kind, e);
    clearDropMarks();
    if (!gesto || !drag) return;
    e.preventDefault();
    if (gesto === "into") await moveIntoFolder(drag.path, path);
    else applyReorder(drag.parent, childName(drag.path), childName(path), gesto === "before");
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
  const fratelli = drag.kind === kind && drag.parent === parentOf(path);
  const dentro = kind === "folder" && drag.kind === "note" && drag.parent !== path;
  // `offsetY` sarebbe relativo all'elemento più interno sotto il cursore (uno
  // span, magari): la frazione va calcolata sulla riga intera.
  const box = row.getBoundingClientRect();
  const y = (e.clientY - box.top) / box.height;
  if (dentro && (!fratelli || (y > 0.3 && y < 0.7))) return "into";
  if (fratelli) return y < 0.5 ? "before" : "after";
  return null;
}

function clearDropMarks() {
  document
    .querySelectorAll(".drop-before, .drop-after, .drop-into")
    .forEach((el) => el.classList.remove("drop-before", "drop-after", "drop-into"));
}

/// Riscrive l'ordine scelto a mano di una cartella: la lista completa dei nomi
/// nell'ordine visibile, col trascinato nella posizione nuova.
function applyReorder(parent: string, dragged: string, target: string, before: boolean) {
  const node = findFolder(buildTree(knownDocs, meta), parent);
  if (!node) return;
  const names = orderedNames(node).filter((n) => n !== dragged);
  const at = names.indexOf(target);
  if (at === -1) return;
  names.splice(before ? at : at + 1, 0, dragged);
  meta.order[parent] = names;
  saveMeta();
  renderFileList(knownDocs);
}

async function moveIntoFolder(id: string, folderPath: string) {
  const to = folderPath ? `${folderPath}/${childName(id)}` : childName(id);
  if (to === id) return;
  try {
    await api.renameDocument(id, to);
  } catch (e) {
    console.error(`FubMD: non riesco a spostare ${id} in ${folderPath || "radice"}: ${e}`);
    return;
  }
  if (folderPath) expanded.add(folderPath);
  saveExpanded();
  renderFileList(await api.listDocuments());
}

/// Il titolo "Note" accoglie le note trascinate fuori da ogni cartella: è la
/// radice (del vault, o dello spazio attivo).
function wireRootDropTarget() {
  filesTitleEl.addEventListener("dragover", (e) => {
    const radice = activeSpace ?? "";
    if (drag?.kind === "note" && drag.parent !== radice) {
      e.preventDefault();
      filesTitleEl.classList.add("drop-into");
    }
  });
  filesTitleEl.addEventListener("dragleave", () => filesTitleEl.classList.remove("drop-into"));
  filesTitleEl.addEventListener("drop", async (e) => {
    filesTitleEl.classList.remove("drop-into");
    if (drag?.kind !== "note") return;
    e.preventDefault();
    await moveIntoFolder(drag.path, activeSpace ?? "");
    drag = null;
  });
}

// --- persistenza dell'organizzazione ---------------------------------------

async function saveMeta() {
  if (metaBroken) return;
  try {
    await api.writeWorkspaceMeta(meta);
  } catch (e) {
    console.error(`FubMD: organizzazione del vault non salvata: ${e}`);
  }
}

/// Un rename (anche uno spostamento) porta con sé icona, pin e posto
/// nell'ordinamento: sono attaccati alla nota, non al suo vecchio path.
function migrateMeta(from: string, to: string) {
  let cambiata = false;
  const icon = meta.icons[from];
  if (icon) {
    delete meta.icons[from];
    meta.icons[to] = icon;
    cambiata = true;
  }
  const i = meta.pinned.indexOf(from);
  if (i !== -1) {
    meta.pinned[i] = to;
    cambiata = true;
  }
  const ordine = meta.order[parentOf(from)];
  const posto = ordine?.indexOf(childName(from)) ?? -1;
  if (ordine && posto !== -1) {
    if (parentOf(from) === parentOf(to)) ordine[posto] = childName(to);
    else ordine.splice(posto, 1);
    cambiata = true;
  }
  if (cambiata) saveMeta();
}

function expandedKey(): string {
  return `fubmd:expanded:${vaultRoot}`;
}

function loadExpanded() {
  try {
    expanded = new Set(JSON.parse(localStorage.getItem(expandedKey()) ?? "[]"));
  } catch {
    expanded = new Set();
  }
}

function saveExpanded() {
  localStorage.setItem(expandedKey(), JSON.stringify([...expanded]));
}

// --- crea e rinomina -------------------------------------------------------

async function newNote(name?: string) {
  const id = await api.createNote(name);
  renderFileList(await api.listDocuments());
  await selectDoc(id);
  editor.focus();
}

/// Rinomina in posto: la riga della lista diventa un campo di testo.
///
/// Si rinomina il **nome pagina**, non il path: cartella ed estensione restano
/// quelle di prima, perché è ciò che l'utente si aspetta scrivendo sopra un
/// titolo. Spostare una nota altrove è un'altra operazione.
function startRename(li: HTMLElement, id: string) {
  const input = document.createElement("input");
  input.value = pageName(id);
  li.textContent = "";
  li.appendChild(input);
  input.focus();
  input.select();

  let chiuso = false;
  const annulla = () => {
    if (chiuso) return;
    chiuso = true;
    renderFileList(knownDocs);
  };
  const conferma = async () => {
    if (chiuso) return;
    chiuso = true;
    const nuovo = input.value.trim();
    if (!nuovo || nuovo === pageName(id)) {
      renderFileList(knownDocs);
      return;
    }
    await renameDoc(id, nuovo);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") conferma();
    else if (e.key === "Escape") annulla();
  });
  input.addEventListener("blur", annulla);
}

async function renameDoc(from: string, newPageName: string) {
  const slash = from.lastIndexOf("/");
  const dir = slash === -1 ? "" : from.slice(0, slash + 1);
  const dot = from.lastIndexOf(".");
  const ext = dot > slash ? from.slice(dot) : "";
  const to = `${dir}${newPageName}${ext}`;

  // Il rename riscrive i wikilink entranti, cioè file di terzi — e fra questi
  // può esserci il documento aperto. Il buffer va messo in salvo prima, o la
  // riscrittura del kernel finirebbe sotto una copia più vecchia.
  await flushPendingSave();
  try {
    await api.renameDocument(from, to);
  } catch (e) {
    console.error(`FubMD: rinomina di ${from} in ${to} rifiutata: ${e}`);
    renderFileList(knownDocs);
    return;
  }
  // `currentDoc` lo aggiorna l'evento `document_renamed`: l'identità è il path,
  // e chi la migra è un solo punto.
  renderFileList(await api.listDocuments());
}

// --- menu contestuale ------------------------------------------------------

interface MenuItem {
  label: string;
  danger?: boolean;
  run: () => void;
}

function showContextMenu(at: MouseEvent, items: MenuItem[]) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.style.left = `${at.clientX}px`;
  menu.style.top = `${at.clientY}px`;
  for (const item of items) {
    const b = document.createElement("button");
    b.textContent = item.label;
    if (item.danger) b.className = "danger";
    b.addEventListener("click", () => {
      closeContextMenu();
      item.run();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  // Il primo click fuori chiude: `once` evita di dover disiscrivere a mano, e
  // il ritardo evita che sia questo stesso click ad attivarlo.
  setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 0);
}

function closeContextMenu() {
  document.getElementById("context-menu")?.remove();
}

// --- cestino ---------------------------------------------------------------

async function deleteDoc(id: string) {
  // Un salvataggio in attesa su questo documento lo farebbe risorgere subito
  // dopo la cancellazione: si disinnesca prima ancora di chiedere conferma, e
  // si rimette in coda se l'utente ci ripensa.
  const salvataggioInAttesa = id === currentDoc && dirty;
  if (salvataggioInAttesa) window.clearTimeout(saveTimer);

  const ok = await confirm(`Spostare «${pageName(id)}» nel cestino?`, {
    title: "Elimina nota",
    kind: "warning",
    okLabel: "Elimina",
    cancelLabel: "Annulla",
  });
  if (!ok) {
    if (salvataggioInAttesa) scheduleSave();
    return;
  }

  await api.deleteDocument(id);
  if (id === currentDoc) {
    // Il buffer sporco di un documento cancellato muore col documento: non è
    // una perdita silenziosa, è l'azione che l'utente ha appena confermato.
    dirty = false;
    currentDoc = null;
    editor.setDoc("");
    previewEl.innerHTML = "";
    await publishContext();
    const docs = await api.listDocuments();
    renderFileList(docs);
    if (docs.length > 0) await selectDoc(docs[0]);
  }
}

async function openTrash() {
  showPanel("trash");
  await refreshTrash();
}

async function refreshTrash() {
  const entries = await api.listTrash();
  trashListEl.innerHTML = "";
  if (entries.length === 0) {
    const vuoto = document.createElement("li");
    vuoto.className = "empty-note";
    vuoto.textContent = "Il cestino è vuoto.";
    trashListEl.appendChild(vuoto);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.title = entry.id;

    const name = document.createElement("span");
    name.className = "trash-name";
    name.textContent = pageName(entry.original);

    const when = document.createElement("span");
    when.className = "trash-when";
    when.textContent = new Date(entry.deleted_at * 1000).toLocaleString();

    const restore = document.createElement("button");
    restore.className = "link-button";
    restore.textContent = "Ripristina";
    restore.addEventListener("click", () => restoreFromTrash(entry.id, entry.original));

    li.append(name, when, restore);
    trashListEl.appendChild(li);
  }
}

async function restoreFromTrash(trashId: string, original: string) {
  let restored: string;
  try {
    restored = await api.restoreFromTrash(trashId);
  } catch {
    // Il path originale è di nuovo occupato: il kernel non inventa nomi al
    // posto dell'utente, quindi l'app ne propone uno e chiede.
    // La convenzione «Nota», «Nota 1», … è del kernel: chiedergliela evita di
    // averne una seconda implementazione qui, destinata a divergere.
    const proposta = await api.proposeFreeName(original);
    const ok = await confirm(
      `«${pageName(original)}» esiste di nuovo. Ripristinare come «${pageName(proposta)}»?`,
      { title: "Ripristina nota", okLabel: "Ripristina", cancelLabel: "Annulla" },
    );
    if (!ok) return;
    restored = await api.restoreFromTrash(trashId, proposta);
  }
  await refreshTrash();
  showPanel("files");
  renderFileList(await api.listDocuments());
  await selectDoc(restored);
}

async function emptyTrash() {
  const entries = await api.listTrash();
  if (entries.length === 0) return;
  const ok = await confirm(
    `Cancellare per sempre ${entries.length} element${entries.length === 1 ? "o" : "i"}?`,
    { title: "Svuota cestino", kind: "warning", okLabel: "Svuota", cancelLabel: "Annulla" },
  );
  if (!ok) return;
  const quanti = await api.emptyTrash();
  console.info(`FubMD: cestino svuotato, ${quanti} element${quanti === 1 ? "o" : "i"} cancellati.`);
  await refreshTrash();
}

async function selectDoc(id: string) {
  // Cambio documento: prima si mette in salvo il buffer corrente (flush),
  // così nessuna modifica resta appesa al debounce.
  await flushPendingSave();
  currentDoc = id;
  const source = await api.readDocument(id);
  editor.setDoc(source);
  dirty = false;
  // Il contesto si pubblica DOPO aver caricato il buffer e azzerato `dirty`:
  // prima, lo span della selezione sarebbe quello del documento precedente.
  await publishContext();
  editor.focus();
  markActive();
  await refreshCurrent();
}

// --- contesto di sessione (§1.9) --------------------------------------------
//
// La shell è l'unica a sapere quale pannello ha il focus, che nota mostra, cosa
// c'è selezionato e in che modalità; il kernel lo custodisce e lo serve alle
// view via `HostApi::active_context`. Qui si decide solo *quando* pubblicarlo:
// **chi** ridisegnare lo dice il kernel, che conosce le `follows` di ogni view.

/// Il contesto del pannello così com'è adesso.
///
/// Lo `span` della selezione c'è solo a buffer pulito: a buffer sporco gli
/// offset dell'editor sono di un testo che il kernel non ha, e uno span
/// mentitore farebbe tagliare i byte sbagliati a chiunque lo usi. Il testo
/// invece è sempre quello vero — ed è ciò che serve a contare le parole
/// selezionate o a mandarle a un comando.
function paneContext(): ViewContext {
  const sel = editor.selection();
  const inEditing = currentDoc !== null && mode !== "reading";
  return {
    pane: MAIN_PANE,
    doc: currentDoc,
    selection: inEditing
      ? { span: dirty ? null : { start: sel.start, end: sel.end }, text: sel.text }
      : null,
    mode,
  };
}

/// Pubblica il contesto e ridisegna **solo** le view che il kernel indica.
async function publishContext() {
  window.clearTimeout(contextTimer);
  try {
    const stale = await api.setActiveContext(paneContext());
    await Promise.all(stale.map(renderDeclaredView));
  } catch (e) {
    // Un vault non ancora aperto non ha un workspace: il contesto non ha dove
    // andare, e non è un errore da mostrare.
    console.debug(`FubMD: contesto non pubblicato: ${e}`);
  }
}

/// Il cursore si muove a ogni tasto; il kernel non deve saperlo a ogni tasto.
/// Il ritardo è la stessa idea del debounce di salvataggio, con un tempo più
/// corto: chi segue la selezione (la struttura, le statistiche) deve sembrare
/// immediato.
function scheduleContext() {
  window.clearTimeout(contextTimer);
  contextTimer = window.setTimeout(publishContext, 150);
}

/// Cambia la modalità del pannello (FEATURES 4.1) e la pubblica.
///
/// In lettura l'editor lascia il posto al documento **reso**: è la stessa cosa
/// che l'anteprima mostrava di lato, ma non è più un pannello sempre acceso
/// accanto all'editor — le tre modalità sono esclusive, e due superfici sullo
/// stesso documento sono due verità da tenere allineate.
async function setMode(next: PaneMode) {
  // Il documento reso lo produce il kernel dal **sorgente salvato**: entrare in
  // lettura con del testo appeso al debounce mostrerebbe la nota di un minuto
  // fa. Si salva prima, e la lettura è sempre di ciò che si è scritto.
  if (next === "reading") await flushPendingSave();
  mode = next;
  document.body.dataset.mode = next;
  // Sorgente = la stessa configurazione senza la resa inline.
  editor.setLivePreview(next === "live_preview");
  for (const b of document.querySelectorAll<HTMLElement>("#mode-switch button")) {
    b.classList.toggle("active", b.dataset.mode === next);
  }
  previewEl.hidden = next !== "reading";
  localStorage.setItem(MODE_KEY, next);
  if (next === "reading") {
    if (currentDoc) await updatePreview(currentDoc);
  } else {
    editor.focus();
  }
  await publishContext();
}

function markActive() {
  document
    .querySelectorAll<HTMLElement>("#files-panel .row.note")
    .forEach((row) => row.classList.toggle("active", row.title === currentDoc));
}

function scheduleSave() {
  if (!currentDoc) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveCurrent, 400);
}

/// Salva subito se c'è un salvataggio in attesa (usato prima di cambiare
/// documento o di operazioni che riscrivono file, come il rename).
async function flushPendingSave() {
  if (!dirty) return;
  window.clearTimeout(saveTimer);
  await saveCurrent();
}

async function saveCurrent() {
  if (!currentDoc) return;
  const text = editor.getDoc();
  await api.writeDocument(currentDoc, text);
  // Pulito solo se nel frattempo non è arrivato altro input: `dirty` è stato
  // rimesso a true dal listener se l'utente ha continuato a scrivere.
  if (editor.getDoc() === text) dirty = false;
  // Il sorgente sul disco è ora quello del buffer: la selezione torna
  // posizionabile, e il kernel — che l'aveva lasciata cadere alla scrittura —
  // deve risaperlo. È l'altra metà della regola dello span.
  await publishContext();
  await refreshCurrent();
}

async function refreshCurrent() {
  if (!currentDoc) return;
  // Le view non si ridisegnano più tutte "perché è cambiato qualcosa": quelle
  // che seguono il vault le sveglia il loro evento (`ViewSpec.refresh`),
  // quelle che seguono la sessione la pubblicazione del contesto
  // (`ViewSpec.follows`). Qui resta ciò che è davvero della shell — e il
  // documento reso solo quando è quello che si sta guardando.
  await Promise.all([
    mode === "reading" ? updatePreview(currentDoc) : Promise.resolve(),
    updateHistory(currentDoc),
  ]);
}

// --- cronologia (versioning) -----------------------------------------------

async function updateHistory(id: string) {
  if (!versioningOn) return;
  const versions = await api.listVersions(id);
  historySummaryEl.textContent =
    versions.length === 0
      ? "nessuna versione"
      : `${versions.length} version${versions.length === 1 ? "e" : "i"}`;
  historyListEl.innerHTML = "";
  historyPreviewEl.hidden = true;

  for (const [i, version] of versions.entries()) {
    const li = document.createElement("li");

    const when = document.createElement("span");
    when.className = "version-when";
    when.textContent = new Date(version.ts).toLocaleString();

    const size = document.createElement("span");
    size.className = "version-size";
    // La più recente è lo stato attuale della nota: dirlo evita di ripristinare
    // ciò che è già sullo schermo.
    size.textContent = i === 0 ? "attuale" : `${version.size} B`;

    const restore = document.createElement("button");
    restore.className = "link-button";
    restore.textContent = "Ripristina";
    restore.addEventListener("click", (e) => {
      e.stopPropagation();
      restoreVersion(id, version.ts);
    });

    li.append(when, size, restore);
    // L'anteprima si carica solo quando serve: elencare le versioni non deve
    // costare la lettura di tutte.
    li.addEventListener("click", () => showVersionPreview(id, version.ts));
    historyListEl.appendChild(li);
  }
}

async function showVersionPreview(id: string, ts: number) {
  historyPreviewEl.hidden = false;
  historyPreviewEl.textContent = await api.readVersion(id, ts);
}

async function restoreVersion(id: string, ts: number) {
  // Il ripristino riscrive il file: il buffer va messo in salvo prima, o le
  // modifiche non ancora scritte se ne andrebbero senza che nessuno lo dica.
  await flushPendingSave();
  await api.restoreVersion(id, ts);
  // Il ripristino è a sua volta una versione (D8): si può annullare.
  if (id === currentDoc) {
    editor.setDoc(await api.readDocument(id));
    dirty = false;
  }
  await refreshCurrent();
}

/// Profondità massima di transclusion: oltre, l'embed resta un link.
const MAX_EMBED_DEPTH = 5;

async function updatePreview(id: string) {
  const html = await api.renderPreview(id);
  previewEl.innerHTML = html;
  wireWikilinks(previewEl);
  await hydrateEmbeds(previewEl, new Set([id]));
}

/// Il Mod-click su un wikilink dentro l'editor: risolve e apre, o crea la
/// nota che manca col nome scritto nel link (come i link dell'anteprima —
/// il backlink c'è già prima della prima riga, è il grafo a ricucirlo).
async function openWikilinkFromEditor(page: string) {
  if (!page) return; // [[#Sezione]]: link interno alla nota, per ora nulla
  const target = await api.resolveLink(page);
  if (target) {
    await selectDoc(target);
    return;
  }
  try {
    await newNote(page);
  } catch (e) {
    console.error(`FubMD: non riesco a creare «${page}»: ${e}`);
  }
}

// Navigazione dei wikilink da un frammento di anteprima.
function wireWikilinks(container: HTMLElement) {
  container.querySelectorAll<HTMLAnchorElement>("a.wikilink").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const page = a.dataset.wikilinkPage;
      if (!page) return;
      const target = await api.resolveLink(page);
      if (target) {
        selectDoc(target);
        return;
      }
      // Link non risolto: cliccarlo crea la nota che manca, col nome scritto
      // nel link (come in Obsidian). Il backlink c'è già prima ancora che
      // l'utente abbia scritto la prima riga — è il grafo a ricucirlo.
      try {
        await newNote(page);
      } catch (err) {
        a.classList.add("unresolved");
        console.error(`FubMD: non riesco a creare «${page}»: ${err}`);
      }
    });
  });
}

// Transclusion: il provider emette solo placeholder `.embed` (render puro,
// per-documento); qui si chiede al kernel il contenuto e lo si innesta,
// ricorsivamente. La catena dei documenti già aperti spezza i cicli
// (`![[A]]` dentro A) e MAX_EMBED_DEPTH limita la profondità.
async function hydrateEmbeds(container: HTMLElement, chain: Set<string>) {
  const slots = Array.from(
    container.querySelectorAll<HTMLElement>(".embed[data-embed-page]"),
  );
  await Promise.all(
    slots.map(async (slot) => {
      const page = slot.dataset.embedPage;
      if (!page) return;
      if (chain.size > MAX_EMBED_DEPTH) {
        slot.classList.add("embed-too-deep");
        return;
      }
      try {
        const content = await api.renderEmbed(page, slot.dataset.embedHeading ?? null);
        if (chain.has(content.doc_id)) {
          slot.classList.add("embed-cycle");
          return;
        }
        slot.innerHTML = content.html;
        slot.classList.add("embed-loaded");
        wireWikilinks(slot);
        await hydrateEmbeds(slot, new Set([...chain, content.doc_id]));
      } catch {
        slot.classList.add("unresolved");
      }
    }),
  );
}

// --- ricerca ---------------------------------------------------------------

function scheduleSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 180);
}

function clearSearch() {
  window.clearTimeout(searchTimer);
  searchInputEl.value = "";
  // Il numero d'ordine avanza anche qui: una risposta già in volo non deve
  // ripopolare un pannello che l'utente ha appena chiuso.
  searchSeq++;
  showPanel("files");
  searchResultsEl.innerHTML = "";
}

/// I tre pannelli della sidebar si escludono a vicenda: uno solo alla volta
/// occupa lo spazio, e chi lo apre non deve ricordarsi di chiudere gli altri.
function showPanel(panel: "files" | "search" | "trash") {
  filesPanelEl.hidden = panel !== "files";
  searchPanelEl.hidden = panel !== "search";
  trashPanelEl.hidden = panel !== "trash";
}

// Avvia una ricerca da fuori (il pannello tag: click su un tag →
// `ViewUpdate::RunSearch`): riempie la barra e usa lo stesso giro dell'utente.
function searchFor(query: string) {
  searchInputEl.value = query;
  runSearch();
}

async function runSearch() {
  const query = searchInputEl.value.trim();
  if (!query) {
    clearSearch();
    return;
  }
  const seq = ++searchSeq;
  let hits: SearchHit[];
  try {
    hits = await api.search(query);
  } catch (e) {
    // Query sintatticamente non valida (l'utente sta ancora digitando
    // `campo:`): non è un errore da mostrare, è un risultato non ancora dato.
    if (seq === searchSeq) showSearchResults([], String(e));
    return;
  }
  if (seq !== searchSeq) return;
  showSearchResults(hits, null);
}

function showSearchResults(hits: SearchHit[], error: string | null) {
  showPanel("search");
  searchSummaryEl.textContent = error
    ? "Query incompleta"
    : hits.length === 0
      ? "Nessun risultato"
      : `${hits.length} risultat${hits.length === 1 ? "o" : "i"}`;

  searchResultsEl.innerHTML = "";
  for (const hit of hits) {
    const li = document.createElement("li");
    li.title = hit.doc;

    const title = document.createElement("span");
    title.className = "hit-title";
    title.textContent = pageName(hit.doc);

    const snippet = document.createElement("span");
    snippet.className = "hit-snippet";
    snippet.appendChild(highlighted(hit.snippet, hit.highlights));

    li.append(title, snippet);
    li.addEventListener("click", () => selectDoc(hit.doc));
    searchResultsEl.appendChild(li);
  }
}

/// Lo snippet con le porzioni evidenziate, come nodi DOM.
///
/// Due invarianti in una funzione sola:
/// - il testo del provider entra **solo** come `textContent`/nodo di testo, mai
///   come HTML: un provider non può iniettare markup (vedi `SearchHit`);
/// - gli offset arrivano in **byte UTF-8** (è la valuta degli `Span` in tutto
///   il modello) mentre le stringhe JS sono UTF-16: si taglia sui byte e si
///   decodifica, invece di fingere che gli indici coincidano — con l'italiano
///   accentato non coinciderebbero quasi mai.
function highlighted(snippet: string, highlights: Span[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const bytes = new TextEncoder().encode(snippet);
  const decoder = new TextDecoder();
  let pos = 0;
  for (const h of highlights) {
    if (h.start < pos || h.end > bytes.length || h.start >= h.end) continue;
    frag.append(decoder.decode(bytes.subarray(pos, h.start)));
    const mark = document.createElement("mark");
    mark.textContent = decoder.decode(bytes.subarray(h.start, h.end));
    frag.append(mark);
    pos = h.end;
  }
  frag.append(decoder.decode(bytes.subarray(pos)));
  return frag;
}

// Disegna una view dichiarativa in un contenitore e chiude il giro
// azione→ViewUpdate: un click torna al provider via `view_action` e la
// risposta si interpreta qui. È il percorso generico di ogni ViewProvider —
// backlink e outline non hanno nulla di cablato lato app.
async function mountView(view: string, target: HTMLElement, node: UiNode) {
  target.innerHTML = "";
  target.appendChild(
    renderUiNode(node, async (action) => {
      const update = await api.viewAction(view, action);
      if (update.kind === "replace") {
        await mountView(view, target, update.root);
        return;
      }
      await applyIntent(update);
    }),
  );
}

// Gli intenti che la shell sa eseguire: navigare, rivelare, cercare.
//
// Arrivano da due parti — un `ViewUpdate` di una view e un `CommandEffect` di
// un comando — e sono gli stessi perché sono intenti della **shell**, non di
// chi li manda. Una copia per sorgente sarebbe una copia da tenere allineata:
// il giorno che la si dimentica, un comando naviga e una view no.
// I due tipi veri del confine, meno il caso che qui non c'entra: `replace`
// riguarda la view che lo ha mandato, e lo gestisce chi la monta. Scritti come
// unione dei tipi rispecchiati e non a mano, così un caso nuovo in Rust arriva
// fin qui.
type ShellIntent = Exclude<ViewUpdate, { kind: "replace" }> | CommandEffect;

async function applyIntent(intent: ShellIntent) {
  switch (intent.kind) {
    case "navigate":
      await selectDoc("doc" in intent ? intent.doc : intent.doc_id);
      break;
    case "reveal": {
      // Apri il documento se non è quello aperto, poi porta la vista
      // sull'intervallo (lo scroll converte byte UTF-8 → posizione editor).
      const doc = "doc" in intent ? intent.doc : intent.doc_id;
      if (doc !== currentDoc) await selectDoc(doc);
      editor.revealByteOffset(intent.span.start);
      break;
    }
    case "run_search":
      searchFor(intent.query);
      break;
    case "custom":
      // Intento con namespace che questa shell non prevede: da contratto
      // non fa nulla (degrado garbato) — chi lo emette conta su una shell
      // che lo capisce, non su questa.
      console.info(`FubMD: intento custom ignorato (ns: ${intent.ns}).`);
      break;
    case "plan":
      // Un piano arrivato fuori dal giro dell'anteprima: non si applica da
      // sé, e la palette lo ha già mostrato quando l'ha chiesto.
      break;
    case "none":
    case "done":
      break;
  }
}

/// Un messaggio all'utente che non richiede una risposta: l'esito di un
/// comando, un errore che non blocca. Testo semplice — ciò che arriva da un
/// provider non diventa mai markup.
function notify(message: string) {
  document.getElementById("toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

/// Ciò che la palette chiede alla shell.
const paletteHost = {
  onEffect: (effect: CommandEffect) => applyIntent(effect),
  notify,
  listDocuments: () => api.listDocuments().catch(() => []),
};

// Le view dichiarative montate, per id: la spec (per sapere QUANDO
// ridisegnare) e il contenitore (per sapere DOVE).
const mountedViews = new Map<string, { spec: ViewSpec; container: HTMLElement }>();

function placementContainer(placement: ViewSpec["placement"]): HTMLElement {
  switch (placement) {
    case "left_sidebar":
      return viewsLeftEl;
    case "right_sidebar":
      return viewsRightEl;
    case "bottom":
      return viewsBottomEl;
  }
}

// Scopre le view dal backend e le monta nel contenitore del loro placement:
// nessun id cablato — una view di plugin compare da sola, con il titolo che
// dichiara. È la metà "discovery" del protocollo (l'altra è `refresh`).
async function mountDeclaredViews() {
  mountedViews.clear();
  viewsLeftEl.innerHTML = "";
  viewsRightEl.innerHTML = "";
  viewsBottomEl.innerHTML = "";
  const specs = await api.listViews();
  for (const spec of specs) {
    const host = placementContainer(spec.placement);
    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = spec.title;
    const container = document.createElement("div");
    container.className = "declared-view";
    container.dataset.viewId = spec.id;
    host.append(title, container);
    mountedViews.set(spec.id, { spec, container });
  }
  viewsBottomEl.hidden = viewsBottomEl.childElementCount === 0;
  await refreshAllViews();
}

async function renderDeclaredView(id: string) {
  const mounted = mountedViews.get(id);
  if (!mounted) return;
  try {
    await mountView(id, mounted.container, await api.renderView(id));
  } catch (e) {
    console.error(`FubMD: la view «${id}» non si è ridisegnata: ${e}`);
  }
}

// Ridisegna tutto (cambio di nota attiva, riconciliazione dopo un overflow).
async function refreshAllViews() {
  await Promise.all([...mountedViews.keys()].map(renderDeclaredView));
}

// Ridisegna le sole view che hanno dichiarato interesse per questo evento
// (`ViewSpec.refresh`): il protocollo dice QUANDO una view invecchia, la
// shell non deve più indovinarlo per conoscenza privata delle feature.
function refreshViewsFor(eventType: KernelEvent["type"]) {
  for (const { spec } of mountedViews.values()) {
    if (spec.refresh.includes(eventType)) renderDeclaredView(spec.id);
  }
}

function handleKernelEvent(e: KernelEvent) {
  // Le view dichiarative si ridisegnano secondo la loro maschera `refresh`,
  // qualunque sia l'evento: vale per le tre feature ufficiali come per una
  // futura view di plugin.
  refreshViewsFor(e.type);
  if (e.type === "index_updated") {
    api.listDocuments().then(refreshFileList);
    // Risultati aperti su un vault che è cambiato: rifarli, non lasciarli
    // invecchiare sotto gli occhi di chi legge. Vale anche per il cestino, che
    // un'altra app (o un'altra finestra) può aver riempito o svuotato.
    if (!searchPanelEl.hidden) scheduleSearch();
    if (!trashPanelEl.hidden) refreshTrash();
  } else if (e.type === "overflow") {
    // Eventi persi (coda troncata): ciò che deriviamo dagli eventi — lista
    // file, anteprima, backlink — va riconciliato da zero, non aggiornato.
    console.warn(`FubMD: ${e.dropped} eventi persi (overflow): riconcilio.`);
    api.listDocuments().then(refreshFileList);
    refreshAllViews();
    refreshCurrent();
    if (currentDoc) reloadIfClean(currentDoc);
  } else if (e.type === "document_changed" && e.id === currentDoc) {
    // La nota è cambiata (anche da fuori: watcher, altra app). Il documento
    // reso si aggiorna solo se è ciò che si sta guardando.
    if (mode === "reading") updatePreview(currentDoc);
    reloadIfClean(currentDoc);
  } else if (e.type === "document_removed" && e.id === currentDoc) {
    // La nota aperta è sparita da fuori (watcher, altra app). Col buffer
    // sporco il buffer vince — è la verità del documento aperto, e il primo
    // salvataggio la ricrea: qui la resurrezione è voluta. Col buffer pulito
    // no: l'editor resterebbe su un contenuto fantasma che il primo autosave
    // resusciterebbe alle spalle dell'utente.
    if (dirty) {
      console.warn(`FubMD: ${e.id} cancellato su disco col buffer sporco: il buffer vince.`);
      return;
    }
    window.clearTimeout(saveTimer);
    currentDoc = null;
    editor.setDoc("");
    previewEl.innerHTML = "";
    // Il kernel svuota già il documento del contesto in `remove_document`: qui
    // si ripubblica per allineare i due stati **e** per farsi dire quali view
    // ridisegnare, che è cosa che il kernel non fa da sé.
    publishContext();
    markActive();
  } else if (e.type === "document_renamed") {
    migrateMeta(e.from, e.to);
    // L'identità è il path: il documento aperto segue il rename.
    if (currentDoc === e.from) {
      currentDoc = e.to;
      markActive();
      publishContext();
      refreshCurrent();
    }
    api.listDocuments().then(refreshFileList);
  }
}

// Il documento aperto è cambiato su disco (watcher, riscrittura link da un
// rename, handler): se il buffer è pulito lo si riallinea; se è sporco il
// buffer vince (verità del documento aperto) e il suo salvataggio riallineerà
// il disco — limite accettato a M2, conflitto esplicito/merge previsto a M3
// (vedi docs/milestones/M3-editor-fidelity.md).
async function reloadIfClean(id: string) {
  if (dirty) {
    console.warn(`FubMD: ${id} è cambiato su disco mentre il buffer è sporco: il buffer vince.`);
    return;
  }
  const source = await api.readDocument(id);
  // Evita il reset del cursore quando l'evento è l'eco del nostro salvataggio.
  if (id === currentDoc && !dirty && editor.getDoc() !== source) {
    editor.setDoc(source);
  }
}

// Un avvio che fallisce non deve morire in silenzio: senza questo, un errore
// dell'IPC lascia la finestra a metà (lista file sì, vault no) e l'unico posto
// dove si vede è la console della webview, che in un'app impacchettata non si
// apre. Il titolo della finestra è il posto più visibile che la shell ha.
init().catch((e) => {
  console.error("FubMD: avvio fallito", e);
  vaultPathEl.textContent = `avvio fallito: ${e}`;
});
