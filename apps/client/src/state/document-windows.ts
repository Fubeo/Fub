import { api } from "../host/ipc";
import { activeDoc } from "./layout";
import { state } from "./store";
import { documentSessions, type DocumentSession } from "./document-session";
import { attachRemoteSurface, DocumentWindowUnsupported, type RemoteSurfaceHandle } from "./document-bridge";
import { showsFileBytes, textProfileFor } from "./document-controller";
import { pageName } from "../rules/mirrored";
import { notify } from "../ui/notify";
import { t } from "../i18n/strings";
import { platformSupports } from "../platform/capabilities";
import { errorText } from "../host/errors";

/// La finestra segue la **sessione**, non il path: una rinomina sposta lo
/// stesso owner sotto un altro id, e la finestra resta sua. Il documento di
/// adesso è sempre `owner.id` (vedi `docOf`).
interface WindowEntry {
  label: string | null;
  vault: string;
  owner: DocumentSession;
  handle: RemoteSurfaceHandle;
  closed: boolean;
  initiatedClose: boolean;
  closing: Promise<boolean> | null;
  /// La finestra è morta da sola e la si sta lasciando (`recoverClosed`):
  /// chi svuota le finestre aspetta questa promessa invece di dire di no.
  recovering: Promise<void> | null;
  destruction: { resolve: () => void; reject: (reason: Error) => void; timer: number } | null;
}
const windows = new Map<string, WindowEntry>();
const closedDuringOpen = new Set<string>();
const requestedDuringOpen = new Set<string>();
let listeners: (() => void)[] = [];
let installing: Promise<void> | null = null;
let opening = 0;
let rootDraining: Promise<boolean> | null = null;

function docOf(entry: WindowEntry): string {
  return entry.owner.id;
}
function report(entry: WindowEntry, error: unknown): void {
  notify(t("windows.drain_failed", { doc: docOf(entry), reason: errorText(error) }), "guasto");
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
      } else if (!entry.initiatedClose) {
        recoverClosed(entry);
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
  // Una piattaforma con una finestra sola (mobile) non ne apre altre: le voci
  // non vengono offerte, e chi arriva qui lo stesso riceve la ragione.
  if (!platformSupports("multipleWindows")) {
    notify(t("windows.unavailable"), "info");
    return;
  }
  const vault = state.vaultRoot;
  if (!doc || !vault) {
    notify(t("docsearch.no_doc"), "guasto");
    return;
  }
  // The window shares the text buffer of a document: the bytes of a media
  // file have none, and a surface that is not text has no window to mount.
  if (showsFileBytes(doc)) {
    notify(t("windows.not_text", { doc: pageName(doc) }), "info");
    return;
  }
  opening++;
  try {
    await installListeners();
    const { request, handle } = await attachRemoteSurface(doc, vault, (source) => textProfileFor(doc, source));
    const owner = documentSessions.get(doc);
    if (!owner || state.vaultRoot !== vault) {
      await handle.dispose();
      throw new Error(t("windows.error.session_gone"));
    }
    const entry: WindowEntry = { label: null, vault, owner, handle, closed: false,
      initiatedClose: false, closing: null, recovering: null, destruction: null };
    windows.set(handle.surfaceId, entry);
    try {
      const { label } = await api.openDocumentWindow(request);
      if (!label || findWindow(label)) throw new Error(t("windows.error.bad_identity"));
      entry.label = label;
      if (closedDuringOpen.delete(label)) {
        entry.closed = true;
        recoverClosed(entry);
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
    if (error instanceof DocumentWindowUnsupported) notify(t("windows.not_text", { doc: pageName(doc) }), "info");
    else notify(t("windows.open_failed", { reason: errorText(error) }), "guasto");
  } finally {
    opening--;
    releaseListenersIfIdle();
  }
}

function sameOwner(entry: WindowEntry): boolean {
  return state.vaultRoot === entry.vault && documentSessions.get(docOf(entry)) === entry.owner
    && entry.owner.snapshot().lifecycle === "open";
}

async function saveConfirmed(entry: WindowEntry): Promise<boolean> {
  if (!sameOwner(entry)) throw new Error(t("windows.error.owner_changed"));
  const dirty = await documentSessions.flush(docOf(entry));
  if (!sameOwner(entry)) throw new Error(t("windows.error.owner_changed_saving"));
  const doc = docOf(entry);
  if (dirty || documentSessions.isDirty(doc) || documentSessions.saveState(doc) === "conflitto") {
    await documentSessions.flushDraft(doc);
    return false;
  }
  return true;
}
/// La nota della finestra non c'è più (cancellata, sparita dal disco): la sua
/// sessione si è chiusa per sempre e ha già messo in bozza ciò che andava
/// tenuto. La finestra non ha niente da congelare né da salvare, e si chiude
/// (audit #513, scenario A): rifiutarla per sempre non protegge nessun testo.
function ownerGone(entry: WindowEntry): boolean {
  return entry.handle.ownerClosed();
}
async function release(entry: WindowEntry): Promise<void> {
  if (!ownerGone(entry) && !await saveConfirmed(entry)) throw new Error(t("windows.error.changed_closing"));
  await entry.handle.dispose();
  windows.delete(entry.handle.surfaceId);
  releaseListenersIfIdle();
}
/// La finestra è morta da sola (crash, chiusa dal sistema) senza passare dalla
/// chiusura di Fub (audit #513, scenario B). Non si deduce che la sua coda
/// fosse vuota: la finestra non può più dire se l'ultima battuta era partita.
/// Ma la sessione della finestra principale ha il testo di tutto ciò che la
/// finestra aveva confermato: lo si salva da lì (o in bozza), la finestra si
/// lascia — mai un blocco per sempre di cambio vault e chiusura — e chi usa Fub
/// sa che le ultime battute non confermate possono mancare.
function recoverClosed(entry: WindowEntry): void {
  if (entry.recovering) return;
  entry.recovering = (async () => {
    // Una chiusura o uno svuotamento già in corso finiscono prima: possono
    // aver lasciato la finestra loro, salvando.
    await entry.closing?.catch(() => false);
    await rootDraining?.catch(() => false);
    // Lasciata da loro, la finestra è uscita col salvataggio confermato. La
    // nota sparita si guarda prima del rilascio: rilasciata, anche la sessione
    // salvata di una finestra si chiude.
    let saved = true;
    let gone = false;
    if (windows.get(entry.handle.surfaceId) === entry) {
      gone = ownerGone(entry);
      if (!gone) {
        try {
          saved = sameOwner(entry) && await saveConfirmed(entry);
        } catch {
          saved = false;
        }
      }
      try {
        await entry.handle.dispose();
      } catch (error) {
        // Il rilascio fallito tiene viva la sessione (con il suo prestito):
        // il testo resta nella finestra principale. La finestra morta non
        // tiene più niente, e si lascia comunque.
        report(entry, error);
      }
      windows.delete(entry.handle.surfaceId);
      releaseListenersIfIdle();
    }
    if (gone) notify(t("windows.closed_gone", { doc: pageName(docOf(entry)) }), "info");
    else notify(t(saved ? "windows.closed_alone" : "windows.closed_alone_unsaved", { doc: pageName(docOf(entry)) }), "guasto");
  })().finally(() => { entry.recovering = null; });
}

async function freeze(entry: WindowEntry): Promise<void> {
  if (entry.closed || ownerGone(entry)) return;
  if (!sameOwner(entry)) throw new Error(t("windows.error.session_changed"));
  await entry.handle.freeze(); // Child has stopped input and main has acknowledged its final seq.
  if (!sameOwner(entry)) throw new Error(t("windows.error.changed_draining"));
}
async function nativeClose(entry: WindowEntry): Promise<void> {
  if (entry.closed) { await release(entry); return; }
  if (!entry.label) throw new Error(t("windows.error.still_opening"));
  entry.initiatedClose = true;
  const destroyed = new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      entry.destruction = null;
      reject(new Error(t("windows.error.destroy_unconfirmed")));
    }, 5000);
    entry.destruction = { resolve, reject, timer };
  });
  try {
    await Promise.all([api.closeDocumentWindow({ label: entry.label }), destroyed]);
    if (!entry.closed) throw new Error(t("windows.error.close_event_missing"));
  } catch (error) {
    if (entry.destruction) {
      globalThis.clearTimeout(entry.destruction.timer);
      entry.destruction.reject(new Error(t("windows.error.close_incomplete")));
      entry.destruction = null;
    }
    if (!entry.closed) entry.initiatedClose = false;
    // Distrutta anche se la chiusura ha risposto con un errore: la finestra
    // non c'è più, e la si lascia come una finestra morta da sola.
    else recoverClosed(entry);
    throw error;
  }
  try {
    await release(entry);
  } catch (error) {
    // La finestra è già distrutta: un salvataggio non confermato adesso non
    // può tenerla aperta, la si lascia dicendolo.
    recoverClosed(entry);
    throw error;
  }
}

/** Freeze *all* surfaces before saving any document; never close on a timer. */
export async function drainDocumentWindows(): Promise<boolean> {
  if (rootDraining) return false;
  // Una finestra morta da sola si sta lasciando: si aspetta il suo
  // salvataggio, poi si guarda ciò che resta.
  // Non si segna lo svuotamento mentre si aspetta: chi si sta lasciando
  // aspetta a sua volta uno svuotamento già partito.
  for (;;) {
    const recovering = [...windows.values()].flatMap((entry) => (entry.recovering ? [entry.recovering] : []));
    if (!recovering.length) break;
    await Promise.allSettled(recovering);
    if (rootDraining) return false;
  }
  const entries = [...windows.values()];
  if (!entries.length) return opening === 0;
  if (opening || entries.some((entry) => !entry.label || entry.closing || entry.closed)) return false;
  let finish: (drained: boolean) => void = () => {};
  rootDraining = new Promise<boolean>((resolve) => { finish = resolve; });
  let drained = false;
  try {
    const barriers = await Promise.allSettled(entries.map(freeze));
    const rejected = barriers.find((barrier): barrier is PromiseRejectedResult => barrier.status === "rejected");
    if (rejected) throw rejected.reason;
    // La finestra di una nota che non c'è più non ha niente da salvare. Si
    // guarda adesso: dopo il rilascio anche la sessione salvata si chiude.
    const gone = entries.filter(ownerGone);
    const live = entries.filter((entry) => !gone.includes(entry));
    const saved = new Set<DocumentSession>();
    for (const entry of live) {
      if (saved.has(entry.owner)) continue;
      if (!await saveConfirmed(entry)) throw new Error(t("windows.error.save_unconfirmed_doc", { doc: docOf(entry) }));
      saved.add(entry.owner);
    }
    // A save may complete while a different local surface edits the same document.
    for (const entry of live) if (!ownerGone(entry) && (!sameOwner(entry) || documentSessions.isDirty(docOf(entry)))) {
      throw new Error(t("windows.error.changed_draining_doc", { doc: docOf(entry) }));
    }
    for (const entry of entries) await nativeClose(entry);
    for (const entry of gone) notify(t("windows.closed_gone", { doc: pageName(docOf(entry)) }), "info");
    drained = true;
    return true;
  } catch (error) {
    for (const entry of entries) entry.handle.thaw();
    notify(t("windows.drain_failed", { doc: docOf(entries[0]), reason: errorText(error) }), "guasto");
    return false;
  } finally {
    finish(drained);
    rootDraining = null;
  }
}

/** The native close request remains denied on failed save or missed acknowledgement. */
export async function closeDocumentWindowByLabel(label: string): Promise<boolean> {
  const entry = findWindow(label);
  if (!entry || rootDraining) return false;
  if (entry.closing) return entry.closing;
  entry.closing = (async () => {
    try {
      if (ownerGone(entry)) {
        await nativeClose(entry);
        notify(t("windows.closed_gone", { doc: pageName(docOf(entry)) }), "info");
        return true;
      }
      await freeze(entry);
      if (!await saveConfirmed(entry)) throw new Error(t("windows.error.save_unconfirmed"));
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
