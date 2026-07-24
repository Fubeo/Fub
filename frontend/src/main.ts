import "./style.css";
import { open } from "@tauri-apps/plugin-dialog";
import { api, onKernelEvent, type KernelEvent } from "./api";
import { createEditor, type Editor } from "./editor";
import { renderUiNode } from "./ui";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const fileListEl = $("#file-list");
const previewEl = $("#preview");
const backlinksEl = $("#backlinks");
const vaultPathEl = $("#vault-path");

let currentDoc: string | null = null;
let editor: Editor;
let saveTimer: number | undefined;

async function init() {
  editor = createEditor($("#editor"), () => scheduleSave());
  $("#open-vault").addEventListener("click", pickVault);
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
  currentDoc = null;
  editor.setDoc("");
  previewEl.innerHTML = "";
  backlinksEl.innerHTML = "";
  renderFileList(info.documents);
  if (info.documents.length > 0) selectDoc(info.documents[0]);
}

function renderFileList(docs: string[]) {
  fileListEl.innerHTML = "";
  for (const id of docs) {
    const li = document.createElement("li");
    li.textContent = pageName(id);
    li.title = id;
    li.className = id === currentDoc ? "active" : "";
    li.addEventListener("click", () => selectDoc(id));
    fileListEl.appendChild(li);
  }
}

async function selectDoc(id: string) {
  currentDoc = id;
  const source = await api.readDocument(id);
  editor.setDoc(source);
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

async function saveCurrent() {
  if (!currentDoc) return;
  await api.writeDocument(currentDoc, editor.getDoc());
  await refreshCurrent();
}

async function refreshCurrent() {
  if (!currentDoc) return;
  await Promise.all([updatePreview(currentDoc), updateBacklinks(currentDoc)]);
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
      if (target) selectDoc(target);
      else a.classList.add("unresolved");
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
  } else if (e.type === "document_changed" && e.id === currentDoc) {
    updatePreview(currentDoc);
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

function pageName(id: string): string {
  const base = id.split("/").pop() ?? id;
  return base.replace(/\.md$/i, "");
}

init();
