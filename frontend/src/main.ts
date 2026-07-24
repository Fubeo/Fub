import "./style.css";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { api, onKernelEvent, type KernelEvent, type SearchHit, type Span } from "./api";
import { createEditor, type Editor } from "./editor";
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

let currentDoc: string | null = null;
// L'ultima lista di documenti disegnata: serve a proporre nomi liberi senza
// interrogare il kernel a ogni tasto. Non è una verità, è un'eco — chi crea o
// rinomina passa comunque dal kernel, che le collisioni le sa davvero.
let knownDocs: string[] = [];
let editor: Editor;
let saveTimer: number | undefined;
let searchTimer: number | undefined;
// Ogni ricerca porta il proprio numero d'ordine: una risposta lenta di una
// query vecchia non deve sovrascrivere i risultati di una più recente.
let searchSeq = 0;
// Il versioning è acceso in questa sessione? Spento significa assente (D7):
// il pannello della cronologia non esiste, e non si interroga.
let versioningOn = false;
// Il buffer ha modifiche non ancora scritte su disco? Finché è sporco, il
// buffer è la verità del documento aperto (vedi docs/architecture/data-model.md,
// "Fonte di verità"): non va MAI sovrascritto da un reload.
let dirty = false;

async function init() {
  editor = createEditor($("#editor"), () => {
    dirty = true;
    scheduleSave();
  });
  $("#open-vault").addEventListener("click", pickVault);
  $("#new-note").addEventListener("click", () => newNote());
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
  versioningOn = info.versioning;
  historyPanelEl.hidden = !versioningOn;
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
  fileListEl.innerHTML = "";
  for (const id of docs) {
    const li = document.createElement("li");
    li.textContent = pageName(id);
    li.title = id;
    li.className = id === currentDoc ? "active" : "";
    li.addEventListener("click", () => selectDoc(id));
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: "Rinomina", run: () => startRename(li, id) },
        { label: "Elimina", danger: true, run: () => deleteDoc(id) },
      ]);
    });
    fileListEl.appendChild(li);
  }
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
    const proposta = freeName(original);
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

/// Il primo nome libero della famiglia `Nota`, `Nota 1`, `Nota 2`, … a partire
/// da un `DocId` occupato. Il confronto è sulla lista che l'app ha in mano: il
/// kernel rifiuterà comunque una collisione che dovesse sfuggire di qui.
function freeName(id: string): string {
  const dot = id.lastIndexOf(".");
  const conEstensione = dot > 0 && !id.slice(dot).includes("/");
  const stem = conEstensione ? id.slice(0, dot) : id;
  const ext = conEstensione ? id.slice(dot) : "";
  const presi = new Set(knownDocs);
  for (let n = 1; ; n++) {
    const candidato = `${stem} ${n}${ext}`;
    if (!presi.has(candidato)) return candidato;
  }
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
  for (const li of Array.from(fileListEl.children) as HTMLElement[]) {
    li.classList.toggle("active", li.title === currentDoc);
  }
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
    api.listDocuments().then(renderFileList);
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
    api.listDocuments().then(renderFileList);
    refreshCurrent();
    if (currentDoc) reloadIfClean(currentDoc);
  } else if (e.type === "document_changed" && e.id === currentDoc) {
    updatePreview(currentDoc);
    reloadIfClean(currentDoc);
  } else if (e.type === "document_renamed") {
    // L'identità è il path: il documento aperto segue il rename.
    if (currentDoc === e.from) {
      currentDoc = e.to;
      markActive();
      refreshCurrent();
    }
    api.listDocuments().then(renderFileList);
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

function pageName(id: string): string {
  const base = id.split("/").pop() ?? id;
  return base.replace(/\.md$/i, "");
}

init();
