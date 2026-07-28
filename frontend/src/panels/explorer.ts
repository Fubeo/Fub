// La sidebar delle note: l'albero, le appuntate, la striscia degli spazi, le
// icone, il trascinamento e la rinomina in posto.
//
// È il pannello più grosso perché è quello con più *gesti*, non con più logica:
// la logica dell'alberatura (cosa è una cartella, cosa è una folder note, che
// ordine hanno i fratelli) sta in `rules/organizer.ts`, ed è pura e provata; il
// dato sta nel sidecar (`state/organization.ts`). Qui c'è il DOM.
import { api } from "../host/ipc";
import { onEvent } from "../state/kernel";
import { migrateOrganization, saveOrganization } from "../state/organization";
import { on, saveActiveSpace, saveExpanded, state } from "../state/store";
import { createNote, refreshDocuments, renameNote } from "../state/vault";
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
} from "../rules/organizer";
import { $ } from "../ui/dom";
import { pickIcon, showContextMenu } from "../ui/menu";
import { refreshOn, registerPanel } from "../ui/panel-host";
import { focusEditor, flushPendingSave, openDocument } from "./document";
import { trashWithConfirm } from "./trash";

const fileListEl = $("#file-list");
const filesTitleEl = $("#files-title");
const spaceStripEl = $("#space-strip");
const spaceTitleEl = $("#space-title");
const pinnedTitleEl = $("#pinned-title");
const pinnedListEl = $("#pinned-list");

/// Il drag in corso nella sidebar, se c'è.
let drag: { path: string; kind: "note" | "folder"; parent: string } | null = null;

export function mountExplorer(): void {
  $("#new-note").addEventListener("click", () => void newNote());
  spaceTitleEl.addEventListener("click", openSpaceNote);
  wireRootDropTarget();

  // Una lista chiesta esplicitamente (apertura del vault, creazione, rinomina,
  // ripristino) si disegna sempre.
  on("documents", renderFileList);
  // L'organizzazione cambiata ridisegna la stessa lista: icone, pin e ordine
  // non passano dal kernel.
  on("organization", () => renderFileList(state.knownDocs));
  on("active-doc", markActive);

  // Una rinomina non è solo una lista invecchiata: l'organizzazione (icona,
  // pin, ordine) è indicizzata per path e va **traslocata prima** del
  // ridisegno. Resta un'iscrizione diretta, e non una riga in più nel
  // `refresh` del pannello, proprio per quel «prima»: il router consegna gli
  // ascoltatori generici — l'host dei pannelli è uno di quelli — prima dei
  // tipizzati, quindi un ridisegno innescato dal registro partirebbe con
  // l'organizzazione ancora al path vecchio.
  onEvent("document_renamed", (e) => {
    migrateOrganization(e.from, e.to);
    void refreshFromKernel();
  });

  // Dentro un lotto (decisione 0011) `index_updated` NON arriva: arriva
  // `batch_ended`, una volta sola. È tutta la differenza fra una rinomina con
  // 200 backlink che costa 201 giri di `list_documents` e una che ne costa uno.
  // Nessun `visible`: l'albero si tiene aggiornato anche mentre la sidebar
  // mostra la ricerca o il cestino, perché alimenta anche ciò che si vede
  // altrove (le appuntate, la striscia degli spazi).
  registerPanel({
    id: "shell:explorer",
    title: "Note",
    placement: "left_sidebar",
    refresh: refreshOn("index_updated", "batch_ended"),
    render: refreshFromKernel,
  });
}

/// La lista dopo un evento del kernel.
///
/// Ricostruire la lista distrugge gli `<li>`: un click a cavallo del rebuild
/// (mousedown sul vecchio nodo, mouseup su quello nuovo) non produce nessun
/// `click` e all'utente sembra servire un doppio click. Gli eventi del kernel
/// arrivano a ogni salvataggio con una lista quasi sempre identica: qui si
/// ricostruisce solo se è cambiata davvero.
async function refreshFromKernel(): Promise<void> {
  const docs = await api.listDocuments();
  const uguale =
    docs.length === state.knownDocs.length && docs.every((d, i) => d === state.knownDocs[i]);
  if (!uguale) renderFileList(docs);
}

function renderFileList(docs: string[]): void {
  state.knownDocs = docs;
  // Uno spazio rimosso (o la cui cartella non esiste più) non può restare
  // selezionato: si torna a casa senza dire niente.
  if (state.activeSpace !== null && !state.meta.spaces.includes(state.activeSpace)) {
    state.activeSpace = null;
    saveActiveSpace();
  }
  renderSpaceStrip();
  renderSpaceTitle();
  renderPinned(docs);
  fileListEl.innerHTML = "";
  renderChildren(buildTree(docs, state.meta, state.activeSpace ?? ""), fileListEl);
}

/// I figli di una cartella, ricorsivamente: prima le sottocartelle (col loro
/// sottoalbero, se aperte), poi le note. La folder note non compare tra i
/// figli: è la cartella stessa, e la apre il click sulla sua riga.
function renderChildren(node: FolderNode, ul: HTMLElement): void {
  for (const sub of node.folders) {
    const li = document.createElement("li");
    li.appendChild(folderRow(sub));
    if (state.expanded.has(sub.path)) {
      const nested = document.createElement("ul");
      nested.className = "tree-children";
      renderChildren(sub, nested);
      li.appendChild(nested);
    }
    ul.appendChild(li);
  }
  const fnote = folderNoteOf(node, state.handledExtensions);
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
  row.className = "row note" + (id === state.currentDoc ? " active" : "");
  row.title = id;
  const icon = state.meta.icons[id];
  if (icon) row.appendChild(rowIcon(icon));
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = pageName(id);
  row.appendChild(name);

  row.addEventListener("click", () => void openDocument(id));
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const appuntata = state.meta.pinned.includes(id);
    showContextMenu(e, [
      { label: "Rinomina", run: () => startRename(row, id) },
      { label: "Icona…", run: () => scegliIcona(e, id) },
      { label: appuntata ? "Togli dalle appuntate" : "Appunta", run: () => togglePin(id) },
      { label: "Converti in cartella", run: () => void convertToFolder(id) },
      { label: "Elimina", danger: true, run: () => void trashWithConfirm(id) },
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
  chevron.textContent = state.expanded.has(folder.path) ? "▾" : "▸";
  chevron.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFolder(folder.path);
  });
  row.appendChild(chevron);
  row.appendChild(rowIcon(state.meta.icons[folder.path] ?? "📁"));

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = folder.name;
  row.appendChild(name);

  const fnote = folderNoteOf(folder, state.handledExtensions);
  if (fnote) row.classList.add("has-note");
  row.addEventListener("click", () => {
    if (fnote) {
      void openDocument(fnote);
      if (!state.expanded.has(folder.path)) toggleFolder(folder.path);
    } else {
      toggleFolder(folder.path);
    }
  });
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e, [
      { label: "Icona…", run: () => scegliIcona(e, folder.path) },
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

function toggleFolder(path: string): void {
  if (!state.expanded.delete(path)) state.expanded.add(path);
  saveExpanded();
  renderFileList(state.knownDocs);
}

function markActive(): void {
  document
    .querySelectorAll<HTMLElement>("#files-panel .row.note")
    .forEach((row) => row.classList.toggle("active", row.title === state.currentDoc));
}

// --- appuntate, icone, spazi ------------------------------------------------

function renderPinned(docs: string[]): void {
  const presenti = new Set(docs);
  const pinned = state.meta.pinned.filter((id) => presenti.has(id));
  pinnedTitleEl.hidden = pinned.length === 0;
  pinnedListEl.hidden = pinned.length === 0;
  pinnedListEl.innerHTML = "";
  for (const id of pinned) {
    const li = document.createElement("li");
    li.appendChild(noteRow(id, { draggable: false }));
    pinnedListEl.appendChild(li);
  }
}

function togglePin(id: string): void {
  const i = state.meta.pinned.indexOf(id);
  if (i === -1) state.meta.pinned.push(id);
  else state.meta.pinned.splice(i, 1);
  void saveOrganization();
}

function scegliIcona(at: MouseEvent, path: string): void {
  pickIcon(at, (icon) => {
    if (icon) state.meta.icons[path] = icon;
    else delete state.meta.icons[path];
    void saveOrganization();
  });
}

// Uno spazio è una cartella registrata nella striscia di icone in cima alla
// sidebar (stile make.md): selezionarlo radica l'albero lì, e il resto del
// vault non esiste. La prima icona è "home", cioè il vault intero.

function renderSpaceStrip(): void {
  spaceStripEl.innerHTML = "";

  const home = document.createElement("button");
  home.className = "space-chip" + (state.activeSpace === null ? " active" : "");
  home.textContent = "🏠";
  home.title = "Tutto il vault";
  home.addEventListener("click", () => selectSpace(null));
  spaceStripEl.appendChild(home);

  for (const path of state.meta.spaces) {
    const chip = document.createElement("button");
    chip.className = "space-chip" + (state.activeSpace === path ? " active" : "");
    chip.textContent = state.meta.icons[path] ?? "🗂️";
    chip.title = childName(path);
    chip.addEventListener("click", () => selectSpace(path));
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: "Icona…", run: () => scegliIcona(e, path) },
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
function renderSpaceTitle(): void {
  spaceTitleEl.textContent =
    state.activeSpace === null
      ? "Note"
      : `${state.meta.icons[state.activeSpace] ?? "🗂️"} ${childName(state.activeSpace)}`;
  spaceTitleEl.classList.toggle("clickable", state.activeSpace !== null);
}

function selectSpace(path: string | null): void {
  state.activeSpace = path;
  saveActiveSpace();
  renderFileList(state.knownDocs);
}

/// Registra una cartella come spazio (se già non lo è) e la seleziona.
function addSpace(path: string): void {
  if (!state.meta.spaces.includes(path)) {
    state.meta.spaces.push(path);
    void saveOrganization();
  }
  selectSpace(path);
}

/// Toglie lo spazio dalla striscia. La cartella e le note restano dove sono:
/// uno spazio è solo un punto di vista, non un contenitore.
function removeSpace(path: string): void {
  const i = state.meta.spaces.indexOf(path);
  if (i === -1) return;
  state.meta.spaces.splice(i, 1);
  if (state.activeSpace === path) state.activeSpace = null;
  saveActiveSpace();
  void saveOrganization();
}

/// Il "+" della striscia: un menu con le cartelle del vault non ancora spazi.
function pickNewSpace(at: MouseEvent): void {
  const candidate = allFolders(buildTree(state.knownDocs, state.meta)).filter(
    (f) => !state.meta.spaces.includes(f.path),
  );
  if (candidate.length === 0) {
    showContextMenu(at, [{ label: "Nessuna cartella disponibile", run: () => {} }]);
    return;
  }
  showContextMenu(
    at,
    candidate.map((f) => ({
      label: `${state.meta.icons[f.path] ?? "📁"} ${f.path}`,
      run: () => addSpace(f.path),
    })),
  );
}

/// Il nome dello spazio nel titolo apre la sua folder note, se esiste.
function openSpaceNote(): void {
  if (state.activeSpace === null) return;
  const node = findFolder(buildTree(state.knownDocs, state.meta), state.activeSpace);
  const fnote = node && folderNoteOf(node, state.handledExtensions);
  if (fnote) void openDocument(fnote);
}

// --- crea, rinomina, converti -----------------------------------------------

/// Crea una nota e la apre.
async function newNote(): Promise<void> {
  const creata = await createNote();
  if (creata) await openDocument(creata);
  focusEditor();
}

/// Rinomina in posto: la riga della lista diventa un campo di testo.
///
/// Si rinomina il **nome pagina**, non il path: cartella ed estensione restano
/// quelle di prima, perché è ciò che l'utente si aspetta scrivendo sopra un
/// titolo. Spostare una nota altrove è un'altra operazione.
function startRename(li: HTMLElement, id: string): void {
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
    renderFileList(state.knownDocs);
  };
  const conferma = async () => {
    if (chiuso) return;
    chiuso = true;
    const nuovo = input.value.trim();
    if (!nuovo || nuovo === pageName(id)) {
      renderFileList(state.knownDocs);
      return;
    }
    await renameDoc(id, nuovo);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void conferma();
    else if (e.key === "Escape") annulla();
  });
  input.addEventListener("blur", annulla);
}

async function renameDoc(from: string, newPageName: string): Promise<void> {
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
    await renameNote(from, to);
  } catch (e) {
    console.error(`FubMD: rinomina di ${from} in ${to} rifiutata: ${e}`);
    renderFileList(state.knownDocs);
  }
  // `currentDoc` lo aggiorna l'evento `document_renamed`: l'identità è il path,
  // e chi la migra è un solo punto.
}

/// `p/X.md` → `p/X/X.md`: la nota diventa la folder note di una cartella nuova
/// col suo nome. I wikilink entranti li riscrive il rename del kernel; icona e
/// pin migrano sull'evento `document_renamed`, come per ogni rename.
///
/// L'estensione non si sceglie: è quella che la nota ha già (`childName`). Prima
/// era `.md` cablata, che avrebbe cambiato formato a una nota per il solo fatto
/// di spostarla in una cartella.
async function convertToFolder(id: string): Promise<void> {
  const stem = pageName(id);
  const dir = parentOf(id);
  const folderPath = dir ? `${dir}/${stem}` : stem;
  try {
    await renameNote(id, `${folderPath}/${childName(id)}`);
  } catch (e) {
    console.error(`FubMD: non riesco a convertire ${id} in cartella: ${e}`);
    return;
  }
  state.expanded.add(folderPath);
  saveExpanded();
  renderFileList(state.knownDocs);
}

// --- drag & drop ------------------------------------------------------------
//
// Due gesti: riordinare tra fratelli dello stesso tipo (l'ordine finisce in
// `meta.order`, per cartella) e trascinare una nota SU una cartella per
// spostarcela dentro (che è un rename: il kernel sposta il file e riscrive i
// wikilink). Le cartelle non si spostano: sarebbero N rename, un'operazione
// che merita di più di un gesto ambiguo.

function wireDrag(row: HTMLElement, path: string, kind: "note" | "folder"): void {
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

function clearDropMarks(): void {
  document
    .querySelectorAll(".drop-before, .drop-after, .drop-into")
    .forEach((el) => el.classList.remove("drop-before", "drop-after", "drop-into"));
}

/// Riscrive l'ordine scelto a mano di una cartella: la lista completa dei nomi
/// nell'ordine visibile, col trascinato nella posizione nuova.
function applyReorder(parent: string, dragged: string, target: string, before: boolean): void {
  const node = findFolder(buildTree(state.knownDocs, state.meta), parent);
  if (!node) return;
  const names = orderedNames(node).filter((n) => n !== dragged);
  const at = names.indexOf(target);
  if (at === -1) return;
  names.splice(before ? at : at + 1, 0, dragged);
  state.meta.order[parent] = names;
  void saveOrganization();
}

async function moveIntoFolder(id: string, folderPath: string): Promise<void> {
  const to = folderPath ? `${folderPath}/${childName(id)}` : childName(id);
  if (to === id) return;
  try {
    await renameNote(id, to);
  } catch (e) {
    console.error(`FubMD: non riesco a spostare ${id} in ${folderPath || "radice"}: ${e}`);
    return;
  }
  if (folderPath) state.expanded.add(folderPath);
  saveExpanded();
  await refreshDocuments();
}

/// Il titolo "Note" accoglie le note trascinate fuori da ogni cartella: è la
/// radice (del vault, o dello spazio attivo).
function wireRootDropTarget(): void {
  filesTitleEl.addEventListener("dragover", (e) => {
    const radice = state.activeSpace ?? "";
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
    await moveIntoFolder(drag.path, state.activeSpace ?? "");
    drag = null;
  });
}
