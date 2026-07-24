import "./style.css";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  api,
  onKernelEvent,
  type KernelEvent,
  type SearchHit,
  type Span,
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
  parentOf,
  type FolderNode,
} from "./organizer";
import { renderUiNode } from "./ui";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const fileListEl = $("#file-list");
const previewEl = $("#preview");
const backlinksEl = $("#backlinks");
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
// Le estensioni che i provider registrati del backend gestiscono. Serve al
// solo `pageName`: quale sia l'estensione di un documento lo sanno i
// `FormatDescriptor`, non la UI — e markdown è il primo formato, non l'unico.
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
// Il drag in corso nella sidebar, se c'è.
let drag: { path: string; kind: "note" | "folder"; parent: string } | null = null;

async function init() {
  editor = createEditor($("#editor"), () => {
    dirty = true;
    scheduleSave();
  });
  $("#open-vault").addEventListener("click", pickVault);
  $("#new-note").addEventListener("click", () => newNote());
  spaceTitleEl.addEventListener("click", openSpaceNote);
  wireRootDropTarget();
  $("#show-trash").addEventListener("click", openTrash);
  $("#close-trash").addEventListener("click", () => showPanel("files"));
  $("#empty-trash").addEventListener("click", emptyTrash);
  searchInputEl.addEventListener("input", scheduleSearch);
  searchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearSearch();
  });
  onKernelEvent(handleKernelEvent);
  const initial = await api.initialVault();
  if (initial) await openVaultPath(initial);
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
  backlinksEl.innerHTML = "";
  clearSearch();
  renderFileList(info.documents);
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
  const fnote = folderNoteOf(node);
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

  const fnote = folderNoteOf(folder);
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
  const fnote = node && folderNoteOf(node);
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
async function convertToFolder(id: string) {
  const stem = pageName(id);
  const dir = parentOf(id);
  const folderPath = dir ? `${dir}/${stem}` : stem;
  try {
    await api.renameDocument(id, `${folderPath}/${stem}.md`);
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
    backlinksEl.innerHTML = "";
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
  editor.focus();
  markActive();
  await refreshCurrent();
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
  await refreshCurrent();
}

async function refreshCurrent() {
  if (!currentDoc) return;
  await Promise.all([
    updatePreview(currentDoc),
    updateBacklinks(currentDoc),
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

async function updateBacklinks(id: string) {
  const node = await api.backlinksView(id);
  backlinksEl.innerHTML = "";
  backlinksEl.appendChild(
    renderUiNode(node, (action) => {
      if (action.startsWith("open:")) selectDoc(action.slice("open:".length));
    }),
  );
}

function handleKernelEvent(e: KernelEvent) {
  if (e.type === "index_updated") {
    api.listDocuments().then(refreshFileList);
    if (currentDoc) updateBacklinks(currentDoc);
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
    refreshCurrent();
    if (currentDoc) reloadIfClean(currentDoc);
  } else if (e.type === "document_changed" && e.id === currentDoc) {
    updatePreview(currentDoc);
    reloadIfClean(currentDoc);
  } else if (e.type === "document_renamed") {
    migrateMeta(e.from, e.to);
    // L'identità è il path: il documento aperto segue il rename.
    if (currentDoc === e.from) {
      currentDoc = e.to;
      markActive();
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

/// Il "nome pagina" di un `DocId`: basename senza l'estensione **gestita**.
///
/// Rispecchia `DocId::page_name` del kernel, ma senza cablare `.md`: le
/// estensioni arrivano dai `FormatDescriptor` dei provider registrati
/// (`VaultInfo.extensions`). Un'estensione che nessun provider gestisce resta
/// nel nome, perché non è un'estensione — è parte del nome del file.
function pageName(id: string): string {
  const base = id.split("/").pop() ?? id;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base;
  const ext = base.slice(dot + 1).toLowerCase();
  return handledExtensions.includes(ext) ? base.slice(0, dot) : base;
}

init();
