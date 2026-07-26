// Il pannello del documento: l'editor, il suo buffer, la modalità, e il
// contesto di sessione che ne esce.
//
// È il pannello che possiede la **verità del documento aperto** — finché il
// buffer è sporco è lui, non il disco (vedi docs/architecture/data-model.md,
// "Fonte di verità") — e per questo tiene insieme cose che sembrano diverse: il
// debounce del salvataggio, il flush prima di ogni operazione che riscrive
// file, la regola dello span nel contesto pubblicato, e cosa fare quando il
// documento cambia sotto i piedi. Sono tutte la stessa domanda.
//
// Questa shell ha **un** pannello (`MAIN_PANE`). Il modello di layout — tab,
// split, pane, workspace salvabili — è la parte del §1.2 lasciata aperta: è
// una feature (FEATURES 3.3), non un refactor, e va decisa insieme al §9.6.
// Ciò che qui è già pronto è che il contesto pubblicato porta l'identità del
// pannello, quindi il giorno che i pannelli saranno due nessuno dovrà
// inventarsi da dove viene la risposta.
import { createEditor, type Editor } from "../editor/editor";
import { api } from "../host/ipc";
import type { PaneMode, ViewContext } from "../host/contract";
import { onEvent } from "../state/kernel";
import { emit, saveMode, state } from "../state/store";
import { createNote } from "../state/vault";
import { $ } from "../ui/dom";
import { clearPreview, setPreviewVisible, updatePreview } from "./preview";

/// L'unico pannello di questa shell. Deve coincidere col `MAIN_PANE` del
/// kernel: un pannello con un altro nome è, da contratto, un altro pannello.
const MAIN_PANE = "main";

export interface DocumentDeps {
  /// Click su un `#tag` nella live preview. Iniettato invece che importato:
  /// il pannello della ricerca apre i documenti, e questo li possiede — se si
  /// importassero a vicenda sarebbe un ciclo.
  searchTag(tag: string): void;
}

let editor: Editor;
let saveTimer: number | undefined;
/// Pubblicazione del contesto: la selezione si muove a ogni tasto, il kernel
/// non deve saperlo a ogni tasto.
let contextTimer: number | undefined;

/// Crea l'editor e attacca il pannello agli eventi che lo riguardano.
export function mountDocument(deps: DocumentDeps): void {
  editor = createEditor($("#editor"), {
    onChange: () => {
      state.dirty = true;
      scheduleSave();
    },
    // Il cursore si è mosso (o il testo è cambiato sotto di lui): il contesto
    // di sessione è invecchiato. Non si pubblica subito — vedi
    // `scheduleContext`.
    onSelectionChange: scheduleContext,
    // Mod-click su un wikilink nella live preview: stesso giro dei link
    // dell'anteprima (risolvi, altrimenti crea la nota che manca).
    onOpenWikilink: (page) => void openWikilink(page),
    onSearchTag: deps.searchTag,
    // Le sorgenti dei completamenti sono l'IPC, ammorbidite: prima che un
    // vault sia aperto rispondono vuoto, non con un errore in console.
    completions: {
      listNotes: () => api.listDocuments().catch(() => []),
      listTags: () => api.listTags().catch(() => []),
    },
  });

  for (const b of document.querySelectorAll<HTMLElement>("#mode-switch button")) {
    b.addEventListener("click", () => void setMode(b.dataset.mode as PaneMode));
  }

  onEvent("document_changed", (e, origin) => {
    if (e.id !== state.currentDoc) return;
    // La nota è cambiata (anche da fuori: watcher, altra app). Il documento
    // reso si aggiorna solo se è ciò che si sta guardando.
    if (state.mode === "reading") void updatePreview(e.id);
    void reloadIfClean(e.id, origin.actor.kind === "watcher");
  });

  onEvent("document_removed", (e) => {
    if (e.id !== state.currentDoc) return;
    // La nota aperta è sparita da fuori (watcher, altra app). Col buffer
    // sporco il buffer vince — è la verità del documento aperto, e il primo
    // salvataggio la ricrea: qui la resurrezione è voluta. Col buffer pulito
    // no: l'editor resterebbe su un contenuto fantasma che il primo autosave
    // resusciterebbe alle spalle dell'utente.
    if (state.dirty) {
      console.warn(`FubMD: ${e.id} cancellato su disco col buffer sporco: il buffer vince.`);
      return;
    }
    closeDocument();
  });

  onEvent("document_renamed", (e) => {
    // L'identità è il path: il documento aperto segue il rename.
    if (state.currentDoc !== e.from) return;
    state.currentDoc = e.to;
    emit("active-doc", e.to);
    void publishContext();
    void refreshCurrent();
  });

  onEvent("overflow", () => {
    // Eventi persi (coda troncata): ciò che deriviamo dagli eventi va
    // riconciliato da zero, non aggiornato.
    void refreshCurrent();
    if (state.currentDoc) void reloadIfClean(state.currentDoc);
  });
}

/// Apre un documento nel pannello.
export async function openDocument(id: string): Promise<void> {
  // Cambio documento: prima si mette in salvo il buffer corrente (flush),
  // così nessuna modifica resta appesa al debounce.
  await flushPendingSave();
  state.currentDoc = id;
  editor.setDoc(await api.readDocument(id));
  state.dirty = false;
  // Il contesto si pubblica DOPO aver caricato il buffer e azzerato `dirty`:
  // prima, lo span della selezione sarebbe quello del documento precedente.
  await publishContext();
  editor.focus();
  emit("active-doc", id);
  await refreshCurrent();
}

/// Chiude il documento aperto senza salvarlo: lo si usa quando il documento
/// non c'è più (cancellato qui o da fuori), cioè quando salvarlo lo
/// resusciterebbe.
export function closeDocument(): void {
  window.clearTimeout(saveTimer);
  state.dirty = false;
  state.currentDoc = null;
  editor.setDoc("");
  clearPreview();
  // Il kernel svuota già il documento del contesto in `remove_document`: qui
  // si ripubblica per allineare i due stati **e** per farsi dire quali view
  // ridisegnare, che è cosa che il kernel non fa da sé.
  void publishContext();
  emit("active-doc", null);
}

/// Il documento è quello aperto?
export function isOpen(id: string): boolean {
  return state.currentDoc === id;
}

/// Risolve un wikilink e lo apre; se non risolve, crea la nota che manca col
/// nome scritto nel link (come in Obsidian). Il backlink c'è già prima ancora
/// che l'utente abbia scritto la prima riga — è il grafo a ricucirlo.
export async function openWikilink(page: string): Promise<void> {
  if (!page) return; // [[#Sezione]]: link interno alla nota, per ora nulla
  const target = await api.resolveLink(page);
  if (target) {
    await openDocument(target);
    return;
  }
  const creata = await createNote(page);
  if (creata) await openDocument(creata);
}

// --- salvataggio ------------------------------------------------------------

function scheduleSave(): void {
  if (!state.currentDoc) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveCurrent(), 400);
}

/// Salva subito se c'è un salvataggio in attesa. Da chiamare prima di cambiare
/// documento e prima di ogni operazione che riscrive file (rename, ripristino
/// di una versione): la riscrittura del kernel finirebbe altrimenti sotto una
/// copia più vecchia.
export async function flushPendingSave(): Promise<void> {
  if (!state.dirty) return;
  window.clearTimeout(saveTimer);
  await saveCurrent();
}

/// Disinnesca un salvataggio in attesa senza eseguirlo, e dice se ce n'era uno.
///
/// Serve a chi sta per **chiedere conferma** di una cancellazione: senza,
/// l'autosave scatterebbe durante la domanda e farebbe risorgere la nota
/// subito dopo. Chi lo chiama deve rimettere in coda con `resumeSave()` se
/// l'utente ci ripensa.
export function suspendSave(id: string): boolean {
  const inAttesa = id === state.currentDoc && state.dirty;
  if (inAttesa) window.clearTimeout(saveTimer);
  return inAttesa;
}

export function resumeSave(): void {
  scheduleSave();
}

async function saveCurrent(): Promise<void> {
  if (!state.currentDoc) return;
  const text = editor.getDoc();
  await api.writeDocument(state.currentDoc, text);
  // Pulito solo se nel frattempo non è arrivato altro input: `dirty` è stato
  // rimesso a true dal listener se l'utente ha continuato a scrivere.
  if (editor.getDoc() === text) state.dirty = false;
  // Il sorgente sul disco è ora quello del buffer: la selezione torna
  // posizionabile, e il kernel — che l'aveva lasciata cadere alla scrittura —
  // deve risaperlo. È l'altra metà della regola dello span.
  await publishContext();
  await refreshCurrent();
}

/// Ricarica il buffer dal disco, ma solo se non ha modifiche non salvate.
///
/// L'origine (decisione 0012) distingue i due casi che prima erano un avviso solo, e sono
/// molto diversi: se ha scritto un'ALTRA APP il lavoro che il buffer sta per
/// coprire non è nostro e non lo possiamo rifare, mentre una riscrittura del
/// kernel o di un plugin la si riottiene rifacendo l'operazione.
async function reloadIfClean(id: string, daFuori = false): Promise<void> {
  if (state.dirty) {
    console.warn(
      daFuori
        ? `FubMD: ${id} è stato cambiato da un'altra applicazione mentre il buffer è sporco: ` +
            `il buffer vince e quella modifica andrà persa al prossimo salvataggio.`
        : `FubMD: ${id} è cambiato su disco mentre il buffer è sporco: il buffer vince.`,
    );
    return;
  }
  const source = await api.readDocument(id);
  // Evita il reset del cursore quando l'evento è l'eco del nostro salvataggio.
  if (id === state.currentDoc && !state.dirty && editor.getDoc() !== source) {
    editor.setDoc(source);
  }
}

/// Rilegge dal disco il documento aperto (usato dopo un ripristino di versione,
/// che riscrive il file sotto al buffer).
export async function reloadCurrent(): Promise<void> {
  if (!state.currentDoc) return;
  editor.setDoc(await api.readDocument(state.currentDoc));
  state.dirty = false;
  await refreshCurrent();
}

async function refreshCurrent(): Promise<void> {
  if (!state.currentDoc) return;
  // Le view non si ridisegnano più tutte "perché è cambiato qualcosa": quelle
  // che seguono il vault le sveglia il loro evento (`ViewSpec.refresh`),
  // quelle che seguono la sessione la pubblicazione del contesto
  // (`ViewSpec.follows`). Qui resta il documento reso, e solo quando è quello
  // che si sta guardando.
  if (state.mode === "reading") await updatePreview(state.currentDoc);
}

// --- contesto di sessione (decisione 0007) ----------------------------------
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
  const inEditing = state.currentDoc !== null && state.mode !== "reading";
  return {
    pane: MAIN_PANE,
    doc: state.currentDoc,
    selection: inEditing
      ? { span: state.dirty ? null : { start: sel.start, end: sel.end }, text: sel.text }
      : null,
    mode: state.mode,
  };
}

/// Pubblica il contesto e annuncia **quali** view il kernel ha dichiarato
/// invecchiate. Chi le ridisegna è `ui/views.ts`: il verso passa dal bus e non
/// da una chiamata, perché quel modulo, per montarle, dipende già da questo.
export async function publishContext(): Promise<void> {
  window.clearTimeout(contextTimer);
  try {
    emit("stale-views", await api.setActiveContext(paneContext()));
  } catch (e) {
    // Un vault non ancora aperto non ha un workspace: il contesto non ha dove
    // andare, e non è un errore da mostrare.
    console.debug(`FubMD: contesto non pubblicato: ${e}`);
  }
}

/// Il cursore si muove a ogni tasto; il kernel non deve saperlo a ogni tasto.
function scheduleContext(): void {
  window.clearTimeout(contextTimer);
  contextTimer = window.setTimeout(() => void publishContext(), 150);
}

/// Cambia la modalità del pannello (FEATURES 4.1) e la pubblica.
///
/// In lettura l'editor lascia il posto al documento **reso**: è la stessa cosa
/// che l'anteprima mostrava di lato, ma non è più un pannello sempre acceso
/// accanto all'editor — le tre modalità sono esclusive, e due superfici sullo
/// stesso documento sono due verità da tenere allineate.
export async function setMode(next: PaneMode): Promise<void> {
  // Il documento reso lo produce il kernel dal **sorgente salvato**: entrare in
  // lettura con del testo appeso al debounce mostrerebbe la nota di un minuto
  // fa. Si salva prima, e la lettura è sempre di ciò che si è scritto.
  if (next === "reading") await flushPendingSave();
  state.mode = next;
  document.body.dataset.mode = next;
  // Sorgente = la stessa configurazione senza la resa inline.
  editor.setLivePreview(next === "live_preview");
  for (const b of document.querySelectorAll<HTMLElement>("#mode-switch button")) {
    b.classList.toggle("active", b.dataset.mode === next);
  }
  setPreviewVisible(next === "reading");
  saveMode(next);
  if (next === "reading") {
    if (state.currentDoc) await updatePreview(state.currentDoc);
  } else {
    editor.focus();
  }
  await publishContext();
}

/// Porta la vista su un offset in byte UTF-8 del documento aperto.
export function revealByteOffset(byteOffset: number): void {
  editor.revealByteOffset(byteOffset);
}

export function focusEditor(): void {
  editor.focus();
}
