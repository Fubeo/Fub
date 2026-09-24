import { api } from "../host/ipc";
import { activeDoc } from "./layout";
import { state } from "./store";
import { documentSessions, type DocumentSession } from "./document-session";
import { attachRemoteSurface, type RemoteSurfaceHandle } from "./document-bridge";
import { notify } from "../ui/notify";
import { t } from "../i18n/strings";

interface WindowEntry {
  label: string | null;
  doc: string;
  vault: string;
  owner: DocumentSession;
  handle: RemoteSurfaceHandle;
  closed: boolean;
  initiatedClose: boolean;
  closing: Promise<boolean> | null;
  destruction: { resolve: () => void; reject: (reason: Error) => void; timer: number } | null;
}
const windows = new Map<string, WindowEntry>();
const closedDuringOpen = new Set<string>();
const requestedDuringOpen = new Set<string>();
let listeners: (() => void)[] = [];
let installing: Promise<void> | null = null;
let opening = 0;
let rootDraining = false;

function report(entry: WindowEntry, error: unknown): void {
  notify(t("windows.drain_failed", { doc: entry.doc, reason: String(error) }), "guasto");
}
function findWindow(label: string): WindowEntry | undefined {
  for (const entry of windows.values()) if (entry.label === label) return entry;
  return undefined;
}
function releaseListenersIfIdle(): void {
  if (windows.size || installing || opening) return;
  for (const remove of listeners.splice(0)) remove();
  closedDuringOpen.clear();
  requestedDuringOpen.clear();
}
async function installListeners(): Promise<void> {
  if (listeners.length === 2) return;
  if (installing) return installing;
  installing = (async () => {
    const removeClosed = await api.onDocumentWindowClosed(({ label }) => {
      const entry = findWindow(label);
      if (!entry) {
        if ([...windows.values()].some((window) => window.label === null)) closedDuringOpen.add(label);
        return;
      }
      entry.closed = true;
      if (entry.destruction) {
        globalThis.clearTimeout(entry.destruction.timer);
        entry.destruction.resolve();
        entry.destruction = null;
      } else if (!entry.closing && !entry.initiatedClose) {
        void recoverClosed(entry).catch((error: unknown) => report(entry, error));
      }
    });
    try {
      const removeRequested = await api.onDocumentWindowCloseRequested(({ label }) => {
        if (!findWindow(label) && opening) {
          requestedDuringOpen.add(label);
          return;
        }
        void closeDocumentWindowByLabel(label).catch((error: unknown) => {
          const entry = findWindow(label);
          if (entry) report(entry, error);
        });
      });
      listeners = [removeClosed, removeRequested];
    } catch (error) {
      removeClosed();
      throw error;
    }
  })();
  try {
    await installing;
  } finally {
    installing = null;
    releaseListenersIfIdle();
  }
}

/** Native close-requested is intercepted by the host until this drain succeeds. */
export async function openCurrentInNewWindow(doc: string | null = activeDoc() ?? state.currentDoc): Promise<void> {
  const vault = state.vaultRoot;
  if (!doc || !vault) {
    notify(t("docsearch.no_doc"), "guasto");
    return;
  }
  opening++;
  try {
    await installListeners();
    const { request, handle } = await attachRemoteSurface(doc, vault);
    const owner = documentSessions.get(doc);
    if (!owner || state.vaultRoot !== vault) {
      await handle.dispose();
      throw new Error("Sessione documento non più disponibile");
    }
    const entry: WindowEntry = { label: null, doc, vault, owner, handle, closed: false,
      initiatedClose: false, closing: null, destruction: null };
    windows.set(handle.surfaceId, entry);
    try {
      const { label } = await api.openDocumentWindow(request);
      if (!label || findWindow(label)) throw new Error("Identità finestra non valida");
      entry.label = label;
      if (closedDuringOpen.delete(label)) {
        entry.closed = true;
        report(entry, new Error("Finestra disconnessa durante l'apertura; sessione conservata"));
      } else if (requestedDuringOpen.delete(label)) {
        await closeDocumentWindowByLabel(label);
      }
    } catch (error) {
      if (!entry.closed) {
        await handle.dispose();
        windows.delete(handle.surfaceId);
      }
      throw error;
    }
  } catch (error) {
    notify(t("windows.open_failed", { reason: String(error) }), "guasto");
  } finally {
    opening--;
    releaseListenersIfIdle();
  }
}

function sameOwner(entry: WindowEntry): boolean {
  return state.vaultRoot === entry.vault && documentSessions.get(entry.doc) === entry.owner
    && entry.owner.snapshot().lifecycle === "open";
}

async function saveConfirmed(entry: WindowEntry): Promise<boolean> {
  if (!sameOwner(entry)) throw new Error("Autorità documento cambiata: sessione mantenuta");
  const dirty = await documentSessions.flush(entry.doc);
  if (!sameOwner(entry)) throw new Error("Autorità documento cambiata durante il salvataggio");
  if (dirty || documentSessions.isDirty(entry.doc) || documentSessions.saveState(entry.doc) === "conflitto") {
    await documentSessions.flushDraft(entry.doc);
    return false;
  }
  return true;
}
async function release(entry: WindowEntry): Promise<void> {
  if (!await saveConfirmed(entry)) throw new Error("Documento modificato durante la chiusura: sessione conservata");
  await entry.handle.dispose();
  windows.delete(entry.handle.surfaceId);
  releaseListenersIfIdle();
}
async function recoverClosed(entry: WindowEntry): Promise<boolean> {
  // A crashed child cannot attest whether its last local operation was sent.
  // Never infer an empty queue merely because the channel disconnected.
  report(entry, new Error("Disconnessione senza drain confermato; sessione conservata"));
  return false;
}

async function freeze(entry: WindowEntry): Promise<void> {
  if (entry.closed) return;
  if (!sameOwner(entry)) throw new Error("Sessione o vault cambiati: finestra mantenuta");
  await entry.handle.freeze(); // Child has stopped input and main has acknowledged its final seq.
  if (!sameOwner(entry)) throw new Error("Sessione cambiata durante il drain");
}
async function nativeClose(entry: WindowEntry): Promise<void> {
  if (entry.closed) { await release(entry); return; }
  if (!entry.label) throw new Error("Finestra ancora in apertura");
  entry.initiatedClose = true;
  const destroyed = new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      entry.destruction = null;
      reject(new Error("La distruzione della finestra non è stata confermata"));
    }, 5000);
    entry.destruction = { resolve, reject, timer };
  });
  try {
    await Promise.all([api.closeDocumentWindow({ label: entry.label }), destroyed]);
    if (!entry.closed) throw new Error("Evento di chiusura nativo mancante");
  } catch (error) {
    if (entry.destruction) {
      globalThis.clearTimeout(entry.destruction.timer);
      entry.destruction.reject(new Error("Chiusura nativa non completata"));
      entry.destruction = null;
    }
    if (!entry.closed) entry.initiatedClose = false;
    throw error;
  }
  await release(entry);
}

/** Freeze *all* surfaces before saving any document; never close on a timer. */
export async function drainDocumentWindows(): Promise<boolean> {
  const entries = [...windows.values()];
  if (rootDraining) return false;
  if (!entries.length) return opening === 0;
  if (opening || entries.some((entry) => !entry.label || entry.closing || entry.closed)) return false;
  rootDraining = true;
  try {
    const barriers = await Promise.allSettled(entries.map(freeze));
    const rejected = barriers.find((barrier): barrier is PromiseRejectedResult => barrier.status === "rejected");
    if (rejected) throw rejected.reason;
    const saved = new Set<DocumentSession>();
    for (const entry of entries) {
      if (saved.has(entry.owner)) continue;
      if (!await saveConfirmed(entry)) throw new Error(`Salvataggio non confermato: ${entry.doc}`);
      saved.add(entry.owner);
    }
    // A save may complete while a different local surface edits the same document.
    for (const entry of entries) if (!sameOwner(entry) || documentSessions.isDirty(entry.doc)) {
      throw new Error(`Documento modificato durante il drain: ${entry.doc}`);
    }
    for (const entry of entries) await nativeClose(entry);
    return true;
  } catch (error) {
    for (const entry of entries) entry.handle.thaw();
    notify(t("windows.drain_failed", { doc: entries[0].doc, reason: String(error) }), "guasto");
    return false;
  } finally {
    rootDraining = false;
  }
}

/** The native close request remains denied on failed save or missed acknowledgement. */
export async function closeDocumentWindowByLabel(label: string): Promise<boolean> {
  const entry = findWindow(label);
  if (!entry || rootDraining) return false;
  if (entry.closing) return entry.closing;
  entry.closing = (async () => {
    try {
      await freeze(entry);
      if (!await saveConfirmed(entry)) throw new Error("Salvataggio non confermato");
      await nativeClose(entry);
      return true;
    } catch (error) {
      entry.handle.thaw();
      report(entry, error);
      return false;
    }
  })();
  try {
    return await entry.closing;
  } finally {
    entry.closing = null;
  }
}

export function pendingDocumentWindows(): string[] {
  return [...windows.values()].map((entry) => entry.label).filter((label): label is string => label !== null);
}
