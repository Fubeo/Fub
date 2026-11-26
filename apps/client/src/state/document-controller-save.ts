// Il gestore del documento: il salvataggio (le bozze, le domande sul non
// salvato, gli avvisi di stato, la chiusura che aspetta i salvataggi).

import { rebaseStaleChange, type EditorChange } from "../editors/core/text-operation";
import { type SourceView } from "../editors/core/registry";
import { modeForContext, readingToggleTarget } from "../editors/core/surface-modes";
import { pageName } from "../rules/organizer";
import { invalidateDocumentCaches } from "./document-caches";
import { api } from "../host/ipc";
import { type PaneMode } from "../host/contract";
import { CASE_KEY, caseOf, toRecover } from "./drafts";
import { addSheetNotice, dismissSheetNotice, setLimitedMode } from "./sheet-notices";
import { unsavedDrafts } from "../host/query";
import type { DraftInfo } from "../host/contract";
import {
  documentSessions,
  flushPendingSave,
  type DocumentSessionEvent,
  type ExternalChangeResult,
} from "./document-session";
import { keepsDiscardedText, VERSION_KEEP } from "./conflict-keep";
import { openIn, activeDoc, layout, pane as paneState, panesWithDoc, setTabOverride, type Tab } from "./layout";
import { lendHeld, lentTo } from "./lend";
import { confirm } from "../platform/confirm";
import { notify, type NoticeHandle } from "../ui/notify";
import { unmountViewFromPane } from "../ui/views";
import { errorText, isErrorKind } from "../host/errors";
import { resolvedLanguage, t } from "../i18n/strings";
import { panes, view } from "./document-controller-state";
import { cardEditors } from "./document-controller-ports";
import { synchronize, redrawTabs, docTitle } from "./document-controller-draw";
import { redrawReading } from "./document-controller-surfaces";
import { selectedMode, publishContext, writingModes, setMode } from "./document-controller-modes";

export let closeDraining = false;

/// La chiusura non aspetta più i salvataggi (la shell si smonta).
export function endCloseDraining(): void {
  closeDraining = false;
}

/// «Vince il mio testo»: la sessione esegue la decisione, questa funzione
/// aggiorna soltanto ciò che la shell disegna.
///
/// Il documento arriva da chi ha chiesto la decisione, non si rilegge qui: fra
/// la conferma e la risoluzione il riquadro attivo può essere cambiato, e la
/// scelta vale per la nota che il dialogo nominava.
export async function resolveKeepingMine(doc: string | null): Promise<void> {
  if (!doc) {
    notify(t("document.conflict_none"), "info");
    return;
  }
  const outcome = await documentSessions.resolveConflict(doc, "mine");
  if (outcome.kind === "none") notify(t("document.conflict_none"), "info");
}

/// «Vince il testo sul disco»: la sessione scarta il buffer e rilegge il
/// documento. Gli editor seguono perché la sessione ha diffuso il testo
/// autorevole alle superfici sottoscritte; qui restano il ridisegno della
/// lettura e delle scritte di stato.
///
/// Prima dello scarto il testo dell'utente va nella Cronologia della nota
/// (`version.keep`, con una nota datata), e solo dopo la conservazione
/// riuscita la sessione rilegge il disco: una conservazione fallita non scarta
/// niente e lo dice. Senza il comando (Cronologia spenta) lo scarto resta
/// quello di sempre, e la conferma lo ha detto.
export async function resolveDiscardingMine(doc: string | null): Promise<void> {
  if (!doc) {
    notify(t("document.conflict_none"), "info");
    return;
  }
  const keep = keepsDiscardedText(doc)
    ? (text: string) => keepDiscardedText(doc, text)
    : undefined;
  const outcome = await documentSessions.resolveConflict(doc, "theirs", keep);
  if (outcome.kind === "none") {
    notify(t("document.conflict_none"), "info");
    return;
  }
  if (outcome.kind === "keep-failed") {
    notify(t("document.conflict.keep_failed", { doc: pageName(doc), reason: errorText(outcome.error) }), "guasto");
    return;
  }
  // La lettura mancata lascia il conflitto aperto: la scelta si può ripetere.
  // Se il testo dell'utente è già nella Cronologia lo si dice, e ripetere la
  // scelta non lo conserva una seconda volta (lo sa la sessione).
  if (outcome.kind === "discarded" && outcome.reload.kind === "unavailable") {
    notify(t(outcome.kept ? "document.conflict.kept_reload_failed" : "document.reload_failed", { doc: pageName(doc) }), "guasto");
  } else if (keep && outcome.kind === "discarded" && outcome.reload.kind === "reloaded") {
    notify(t("document.conflict.kept", { doc: pageName(doc) }), "info");
  }
  redrawReading(doc);
  view.drawSave();
  redrawTabs(doc);
}

/// Conserva `text` nella Cronologia di `doc`, con la nota datata del conflitto.
export async function keepDiscardedText(doc: string, text: string): Promise<void> {
  const when = new Date().toLocaleString(resolvedLanguage(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  await api.invokeCommand(VERSION_KEEP, { doc, text, note: t("document.conflict.kept_note", { when }) }, "apply");
}

/// Una linguetta è stata chiusa: si lascia andare ciò che teneva in vita.
///
/// Le due specie di linguetta hanno due cose diverse da rilasciare, e nessuna delle
/// due si raccoglie da sé: un documento ha un buffer che va **salvato** prima di
/// dimenticarlo, una view ha un pannello registrato e un albero montato. Che
/// stiano nella stessa funzione è ciò che tiene chi chiude una linguetta dal doversi
/// ricordare quale delle due aveva sotto le dita.
export async function releaseTab(paneId: string, tab: Tab | null): Promise<void> {
  if (!tab) return;
  if (tab.k === "doc") await dismissIfUnwatched(tab.doc, paneId);
  else unmountViewFromPane(tab.view, paneId);
}

/// Un documento che nessun riquadro mostra più viene rilasciato dalla sessione:
/// il flush, la bozza e la chiusura sono una sola decisione del suo owner.
export async function dismissIfUnwatched(doc: string, paneId: string = layout.focus): Promise<void> {
  // Anche una scheda della lavagna che ci scrive dentro la tiene aperta.
  if (panesWithDoc(doc).length > 0 || cardEditors.holds(doc)) return;
  const outcome = await documentSessions.release(doc);
  if (outcome.kind === "unsaved") await keepOrDiscardUnsaved(doc, paneId);
}

/// Perché una domanda «Modifiche non salvate» si ritira prima della risposta.
///
/// - `replaced`: una domanda nuova sullo stesso documento ha preso il suo
///   posto; decide quella, e questa non fa niente.
/// - `removed`: il file è sparito da fuori; il testo è già nell'avviso con
///   «Ricrea» (`removed` qui sotto), e non c'è più una nota da riaprire.
/// - `reopen`: il file è cambiato o ha cambiato nome da fuori. Come «Tienila
///   aperta»: la nota torna, a `doc` (il nome nuovo, per una rinomina); con
///   `conflict` si tenta subito il salvataggio, che trova il disco cambiato e
///   mette la barra del conflitto.
type UnsavedWithdrawal =
  | { kind: "replaced" }
  | { kind: "removed" }
  | { kind: "reopen"; doc: string; conflict: boolean };

/// Le domande «Modifiche non salvate» aperte, per documento.
const unsavedQuestions = new Map<string, AbortController>();

/// Ritira la domanda aperta su `doc`, se c'è, col suo motivo.
export function withdrawUnsavedQuestion(doc: string, why: UnsavedWithdrawal): void {
  const question = unsavedQuestions.get(doc);
  if (!question) return;
  unsavedQuestions.delete(doc);
  question.abort(why);
}

/// La linguetta è già chiusa, ma il buffer non si è potuto salvare: la sessione
/// è ancora viva, ed è l'unica copia del lavoro. Si chiede, e senza una
/// risposta esplicita la nota torna aperta dov'era.
///
/// Se mentre si chiede il file cambia da fuori, la domanda è vecchia: scartare
/// vorrebbe dire scegliere fra due testi che la persona non ha visto. La
/// finestra si chiude come «Tienila aperta» e la scelta resta sua
/// (`UnsavedWithdrawal`).
export async function keepOrDiscardUnsaved(doc: string, paneId: string): Promise<void> {
  withdrawUnsavedQuestion(doc, { kind: "replaced" });
  const question = new AbortController();
  unsavedQuestions.set(doc, question);
  let discard: boolean;
  try {
    discard = await confirm(t("document.close_unsaved", { doc: pageName(doc) }), {
      title: t("document.close_unsaved.title"),
      okLabel: t("document.close_unsaved.discard"),
      cancelLabel: t("document.close_unsaved.keep"),
      danger: true,
    }, question.signal).catch(() => false);
  } finally {
    if (unsavedQuestions.get(doc) === question) unsavedQuestions.delete(doc);
  }
  const why = question.signal.aborted ? (question.signal.reason as UnsavedWithdrawal) : null;
  if (why?.kind === "replaced" || why?.kind === "removed") return;
  const target = why?.kind === "reopen" ? why.doc : doc;
  // Nel frattempo qualcuno può averla riaperta: allora ha già un riquadro, o
  // una scheda della lavagna ci scrive, e scartarla le toglierebbe il testo.
  if (panesWithDoc(target).length > 0 || cardEditors.holds(target)) return;
  if (discard && why === null) {
    documentSessions.discardUnsaved(doc);
    return;
  }
  openIn(paneState(paneId) ? paneId : layout.focus, target);
  await synchronize();
  view.drawSave();
  // Il conflitto si vede al primo salvataggio: lo si tenta subito, invece di
  // aspettare la battuta dopo. Se il disco è ancora guasto il testo resta nel
  // buffer, come prima; e un salvataggio che rifiuta non toglie la barra né
  // lo stato, che si disegnano comunque.
  if (why?.conflict && panesWithDoc(target).length > 0) {
    try {
      await documentSessions.flush(target);
    } catch (error) {
      // Il salvataggio non è nemmeno partito: la persona lo deve sapere, con
      // l'avviso di sempre e il suo «Riprova».
      console.error(error);
      const reason = errorText(error);
      showStateNotice(target, "save", (name) => t("document.save_failed", { doc: pageName(name), reason }), (message) => notify(message, "guasto", {
        label: t("app.retry"),
        run: saveNow,
      }));
    }
    drawPaneConflict(target);
    view.drawSave();
  }
}

/// Ciò che tab, stato di salvataggio e banner mostrano della sessione di un
/// documento, com'era all'ultimo ridisegno. Ogni battuta emette `changed`, ma
/// di rado cambia qualcosa di visibile: ridisegnare lo stesso a ogni carattere
/// ridipingeva tutte le tab e forzava un layout (`scrollIntoView`).
export const paintedSessions = new Map<string, string>();

/// I documenti il cui salvataggio il sistema ha rifiutato perché il file non
/// si può scrivere (`permission_denied`, PA T59), già detti all'utente. Il
/// salvataggio automatico ci riprova a ogni pausa (così il file torna a
/// salvarsi da solo appena ridiventa scrivibile), ma l'avviso non si ripete a
/// ogni battuta: torna solo dopo un salvataggio riuscito o un «Riprova».
export const deniedSaves = new Set<string>();

/// Gli avvisi a galla che parlano di uno **stato** di una nota, non di un
/// gesto: `save` dice che non si salva (e perché, che la riga del foglio non
/// dice), `outside` che il file è cambiato da fuori o è in conflitto. Uno per
/// tipo e per nota: lo stesso fatto non si ripete, e un fatto nuovo dello
/// stesso tipo prende il posto del vecchio. Si ritirano quando lo stato finisce
/// (`settleStateNotices`): un avviso che dice «non salvato» sotto una nota
/// salvata mente.
interface StateNotices {
  save?: StateNotice;
  outside?: StateNotice;
}

/// Un avviso di stato, con la nota di cui parla e la sua frase per un nome
/// della nota: alla rinomina lo stato la segue, `ref` passa al nome nuovo (le
/// azioni del toast lo leggono lì) e il toast si riscrive con `text`. `fact`
/// dice quanto pesa ciò che dice `outside`: il conflitto (non è stato scritto
/// niente, e si deve scegliere) prende il posto del cambio da fuori.
interface StateNotice {
  readonly handle: NoticeHandle;
  readonly ref: { doc: string };
  readonly text: (doc: string) => string;
  readonly fact?: "change" | "conflict";
}
const stateNotices = new Map<string, StateNotices>();

/// Dice lo stato `slot` di `doc`: `text` è la frase per un nome della nota,
/// `show` la mette a galla (tono e azioni; le azioni leggono la nota da `ref`).
function showStateNotice(
  doc: string,
  slot: keyof StateNotices,
  text: (doc: string) => string,
  show: (message: string, ref: { doc: string }) => NoticeHandle,
  fact?: StateNotice["fact"],
): void {
  const own = stateNotices.get(doc) ?? {};
  own[slot]?.handle.withdraw();
  const ref = { doc };
  const handle = show(text(doc), ref);
  own[slot] = fact ? { handle, ref, text, fact } : { handle, ref, text };
  stateNotices.set(doc, own);
}

export function withdrawStateNotices(doc: string, slot?: keyof StateNotices): void {
  const own = stateNotices.get(doc);
  if (!own) return;
  for (const key of slot ? [slot] : (["save", "outside"] as const)) {
    own[key]?.handle.withdraw();
    delete own[key];
  }
  if (!own.save && !own.outside) stateNotices.delete(doc);
}

/// La nota cambia nome: i suoi avvisi di stato la seguono, riscritti col nome
/// nuovo (lo stesso toast: niente nuovo annuncio né riga nello storico), e
/// così la sola lettura già detta, che non si ripete a ogni pausa. Il cambio
/// da fuori di una nota che adesso si vede lo dicono il foglio e la barra.
export function moveStateNotices(from: string, to: string): void {
  if (deniedSaves.delete(from)) deniedSaves.add(to);
  const own = stateNotices.get(from);
  if (!own) return;
  stateNotices.delete(from);
  withdrawStateNotices(to);
  stateNotices.set(to, own);
  for (const key of ["save", "outside"] as const) {
    const notice = own[key];
    if (!notice) continue;
    notice.ref.doc = to;
    notice.handle.rewrite(notice.text(to));
  }
  if (docOnScreen(to)) withdrawStateNotices(to, "outside");
}

export function withdrawAllStateNotices(): void {
  for (const doc of [...stateNotices.keys()]) withdrawStateNotices(doc);
  blindDraftNotice?.withdraw();
  blindDraftNotice = undefined;
}

/// Le bozze non arrivano più sul disco: è un fatto di tutte le sessioni (la
/// rete sotto il testo non salvato), non di una nota, come dice la frase.
/// Uno solo, e solo finché serve: finché una bozza non torna a scriversi
/// (`draft-restored`) e c'è ancora testo non salvato da proteggere.
let blindDraftNotice: NoticeHandle | undefined;

/// Allinea l'avviso della bozza allo stato della collezione: lo dice se la
/// rete manca e c'è testo non salvato, lo ritira altrimenti. Lo chiamano ogni
/// evento di sessione e il montaggio (un controller nuovo rilegge lo stato:
/// la collezione non ripete `draft-blind` finché la rete resta giù).
export function syncBlindDraftNotice(): void {
  const needed = documentSessions.isDraftBlind() && documentSessions.dirtyIds().length > 0;
  if (needed && !blindDraftNotice) blindDraftNotice = notify(t("draft.blind"), "guasto");
  else if (!needed && blindDraftNotice) {
    blindDraftNotice.withdraw();
    blindDraftNotice = undefined;
  }
}

/// La nota è la tab attiva di almeno un riquadro: ciò che la barra e il foglio
/// dicono lo si vede, e un avviso a galla lo ripeterebbe.
function docOnScreen(doc: string): boolean {
  return panesWithDoc(doc).some((paneId) => activeDoc(paneId) === doc);
}

/// Allinea avvisi e righe del foglio allo stato della sessione. Salvata (o
/// chiusa), non resta niente da dire; in conflitto, la barra del conflitto
/// dice il fatto per intero: la fascia «cambiato da fuori» e l'avviso di un
/// salvataggio fallito prima del conflitto se ne vanno, e così l'avviso a
/// galla se la nota si vede.
function settleStateNotices(doc: string): void {
  const state = documentSessions.saveState(doc);
  if (state === null || state === "salvato") {
    withdrawStateNotices(doc);
    return;
  }
  if (state === "conflitto") {
    for (const kind of ["changed_on_disk", "overwritten"] as const) dismissSheetNotice(doc, kind);
    withdrawStateNotices(doc, "save");
    if (docOnScreen(doc)) withdrawStateNotices(doc, "outside");
  }
}

/// Registra l'aspetto della sessione; falso se è quello già disegnato.
function sessionLookChanged(doc: string): boolean {
  const state = documentSessions.saveState(doc);
  if (state === null) {
    paintedSessions.delete(doc);
    deniedSaves.delete(doc);
    return true;
  }
  const look = `${state}|${documentSessions.isDirty(doc)}|${documentSessions.isDeletionPending(doc)}`;
  if (paintedSessions.get(doc) === look) return false;
  paintedSessions.set(doc, look);
  return true;
}

export function handleSessionEvent(event: DocumentSessionEvent): void | Promise<void> {
  // Gli altri eventi ridisegnano comunque: il gate va tenuto al passo.
  const looksDifferent = sessionLookChanged(event.id);
  settleStateNotices(event.id);
  if (event.kind !== "draft-blind") syncBlindDraftNotice();
  if (event.kind === "deletion-changed") {
    setReadOnlyForDocument(event.id, event.pending);
    view.drawSave();
    redrawTabs(event.id);
    drawPaneConflict(event.id);
    return;
  }
  if (event.kind === "changed") {
    if (!looksDifferent) return;
    view.drawSave();
    redrawTabs(event.id);
    drawPaneConflict(event.id);
    return;
  }
  if (event.kind === "draft-blind") {
    // Il fatto si dice anche quando non viene dalla rete della collezione
    // (la bozza di una nota sparita da fuori che non si scrive).
    blindDraftNotice ??= notify(t("draft.blind"), "guasto");
    return;
  }
  if (event.kind === "draft-restored") {
    syncBlindDraftNotice();
    return;
  }
  if (event.kind === "save-failed") {
    if (event.outcome === "conflitto") {
      // A schermo basta la barra del conflitto; fuori schermo un avviso, uno
      // solo: prende il posto di quello del cambio da fuori, che diceva meno.
      const doc = event.id;
      if (!docOnScreen(doc) && stateNotices.get(doc)?.outside?.fact !== "conflict") {
        showStateNotice(doc, "outside", (name) => t("document.save_conflict", { doc: pageName(name) }), (message) => notify(message, "guasto"), "conflict");
      }
    } else if (isErrorKind(event.error, "permission_denied")) {
      // Il file è in sola lettura (PA T59), o l'host lo tiene tale per un
      // suo motivo: la bozza resta sporca e nessun byte è perso, ma non è un
      // guasto del disco.
      const doc = event.id;
      if (!deniedSaves.has(doc)) {
        deniedSaves.add(doc);
        showStateNotice(doc, "save", (name) => t("document.save_read_only", { doc: pageName(name) }), (message, ref) => notify(message, "guasto", {
          label: t("app.retry"),
          run: () => {
            deniedSaves.delete(ref.doc);
            return saveNow();
          },
        }));
      }
    } else {
      // La bozza resta sporca e il salvataggio automatico ci riprova alla
      // prossima battuta; «Riprova» serve a chi non vuole scrivere per salvare.
      // Un avviso per nota: il tentativo dopo che fallisce ancora prende il
      // posto del precedente, col motivo di adesso.
      const doc = event.id;
      const reason = errorText(event.error);
      showStateNotice(doc, "save", (name) => t("document.save_failed", { doc: pageName(name), reason }), (message) => notify(message, "guasto", {
        label: t("app.retry"),
        run: saveNow,
      }));
    }
    view.drawSave();
    redrawTabs(event.id);
    drawPaneConflict(event.id);
    return;
  }
  view.drawSave();
  redrawTabs(event.id);
  drawPaneConflict(event.id);
  if (event.kind === "saved") {
    deniedSaves.delete(event.id);
    // Il testo è su disco: ciò che l'avviso diceva di non ancora deciso è
    // passato. Anche la bozza ritrovata, che diceva «copia non salvata da
    // recuperare», ma solo col buffer pulito: un salvataggio di un testo
    // superato da battute nuove (o da una bozza rientrata intanto) non
    // prova che il disco abbia il testo ritrovato (IMP-146). La bozza sul
    // disco non è di qui: la toglie la sessione dopo la scrittura riuscita.
    for (const kind of ["changed_on_disk", "overwritten"] as const) dismissSheetNotice(event.id, kind);
    if (!documentSessions.isDirty(event.id)) dismissSheetNotice(event.id, "recovered");
    drawPaneConflict(event.id);
    redrawReading(event.id);
  }
  return publishContext();
}

/// Ridisegna il banner conflitto dei riquadri che mostrano questo documento.
/// Solo ridisegno + comandi esistenti; mai semantica sessione (R01-R04 intatti).
export function drawPaneConflict(doc: string): void {
  for (const paneId of panesWithDoc(doc)) {
    const r = panes.get(paneId);
    if (r && activeDoc(paneId) === doc) view.drawConflict(r, doc);
  }
}

/// Le schede di `doc` sono in sola lettura per una cancellazione in sospeso
/// (`readOnly`, che chi chiama legge dalla sessione col nome giusto), per la
/// chiusura in corso o perché il documento è in prestito a un'app Craft, o
/// sta per esserlo (`lendHeld`: la prenotazione conta già).
export function setReadOnlyForDocument(doc: string, readOnly: boolean): void {
  for (const paneId of panesWithDoc(doc)) {
    panes.get(paneId)?.surface?.setReadOnly?.(readOnly || closeDraining || lendHeld(doc));
  }
  cardEditors.refreshReadOnly();
}

/// Perché una scheda di `doc` non accetta modifiche: la chiusura in corso,
/// una cancellazione in sospeso, o il prestito a un'app Craft (T17), anche
/// soltanto prenotato.
export function heldReadOnly(doc: string): boolean {
  return closeDraining || documentSessions.isDeletionPending(doc) || lendHeld(doc);
}

/// Perché `doc` è fermo (`heldReadOnly`), con le parole delle righe di un
/// riquadro; `null` se non lo è. Lo dice una scheda della lavagna che non
/// entra in scrittura (N6 T96).
export function heldWhy(doc: string): string | null {
  if (documentSessions.isDeletionPending(doc)) return t("notice.read_only", { doc: docTitle(doc) });
  const app = lentTo(doc);
  if (app !== null) return t("lend.notice", { app });
  if (closeDraining || lendHeld(doc)) return t("canvas.card.readonly_why", { name: docTitle(doc) });
  return null;
}

/** Ferma gli input locali prima del drain delle finestre e del salvataggio. */
export function freezeDocumentSurfaces(frozen: boolean): void {
  closeDraining = frozen;
  for (const [paneId, pane] of panes) {
    const doc = activeDoc(paneId);
    if (doc) pane.surface?.setReadOnly?.(frozen || documentSessions.isDeletionPending(doc) || lendHeld(doc));
  }
  cardEditors.refreshReadOnly();
}

/// **Ritrova ciò che era rimasto non salvato** (§15.2), all'apertura del vault.
///
/// Il recupero è un buffer **precaricato e sporco**, e non un file riscritto:
/// è la scelta che tiene la decisione all'utente. Il disco resta com'è finché
/// qualcuno non salva, e la nota recuperata si comporta esattamente come una
/// che si stava scrivendo — pallino sulla tab, «Non salvato» nella barra di
/// stato, e i gesti di sempre per tenerla o buttarla. Non serve una superficie
/// nuova per una cosa che la shell sa già disegnare.
///
/// Che sia un buffer e non un dialogo modale ha anche una conseguenza che vale
/// più dell'economia di codice: chi apre il vault e vuole solo leggere qualcosa
/// non viene fermato da una domanda. Il testo c'è, lo trova quando apre quella
/// nota, e nel frattempo la notifica gli dice che c'è.
///
/// Le bozze **superate** — il disco contiene già quel testo, cioè il caso
/// normale dopo una chiusura ordinata — non arrivano fin qui: le toglie
/// `toRecover`.
///
/// Il ricongiungimento ha una condizione di **identità**: la bozza torna nel
/// suo documento solo se il buffer che c'è già non è sporco. Quando `recoverDrafts`
/// corre, `synchronize` ha appena letto dal disco le tab ripristinate dal layout —
/// buffer **puliti**, cioè la copia più *vecchia* fra le due — e la bozza deve
/// rientrare sopra di loro. Un buffer sporco invece è un testo battuto dopo, in
/// questa sessione: un'identità diversa, e la bozza resta orfana sul disco.
///
/// Il rientro non si ferma al buffer: chi arrivava già a schermo leggeva il
/// disco — la tab ripristinata dal layout, che `synchronize` ha appena
/// disegnato — e la bozza è più nuova di lui. L'editor, il pallino sulla tab,
/// la barra di stato e la lettura si portano con lei, o la prima battuta,
/// riscritta sopra il testo vecchio che si vede, coprirebbe il recupero senza
/// che nessuno l'abbia mai visto.
export async function recoverDrafts(): Promise<number> {
  void refreshLimitedMode();
  let drafts: DraftInfo[];
  try {
    // Una bozza con lo stesso testo del file non è da recuperare: si toglie
    // invece di diventare un conflitto (IMP-1801).
    drafts = await documentSessions.withoutSuperseded(toRecover(await unsavedDrafts()));
  } catch {
    // Un recupero che non parte non deve impedire di aprire il vault: è una
    // rete di sicurezza, e una rete che blocca la porta è peggio di nessuna
    // rete. Ciò che non si è letto lo dice il rapporto diagnostico.
    return 0;
  }
  const rejoined = documentSessions.rejoin(drafts);
  // Editor, pallino sulla tab e barra di stato vengono portati dal recupero
  // stesso: `restoreDraft` sostituisce il testo autorevole e la sessione lo
  // diffonde alle superfici sottoscritte — una volta, senza un giro di sync
  // in più qui. Restano le due cose che sono del pannello: le notifiche e la
  // lettura, che mostrava il disco e ora mostra il testo rientrato.
  for (const b of rejoined) {
    notify(`${b.doc}: ${t(CASE_KEY[caseOf(b)])}`, "info");
    addSheetNotice(b.doc, "recovered", CASE_KEY[caseOf(b)]);
    drawPaneConflict(b.doc);
  }
  view.drawSave();
  for (const b of rejoined) redrawReading(b.doc);
  // Il conto dice quante sono **rientrate davvero**, non quante erano in fila:
  // la notifica dice «è stato ritrovato, aprile per decidere», e una bozza
  // saltata — il buffer sporco che la precede — non è ritrovata e non ha
  // nessun documento da aprire.
  return rejoined.length;
}

/// La modalità limitata dei componenti è del vault, e ogni foglio la porta
/// sopra il testo. Si chiede quando il vault si apre; un host che non risponde
/// vale «non limitata», e un avviso che non c'è non rompe niente.
async function refreshLimitedMode(): Promise<void> {
  try {
    setLimitedMode(await api.pluginLimitedMode());
  } catch {
    setLimitedMode(null);
  }
  for (const [paneId, r] of panes) view.drawConflict(r, activeDoc(paneId));
}

// --- salvataggio ------------------------------------------------------------
//
// Del **documento**, non del riquadro: due riquadri sulla stessa nota hanno un
// debounce solo, o due salvataggi in corsa scriverebbero due volte lo stesso
// testo e la seconda scrittura arriverebbe dopo un evento che dice che il file
// è cambiato.

/// Qualcuno ha scritto in un riquadro. Il pannello non valida niente e non
/// sincronizza nessuno: porta l'operazione tipizzata alla sessione, che la
/// misura sul testo autorevole, aggiorna una volta, programma il salvataggio
/// e diffonde l'esito ai pari. Se l'operazione non regge — una superficie
/// rimasta indietro — la battuta si ribasa sul testo autorevole e si
/// ripresenta alla sessione, che resta l'unica a validarla; il riquadro
/// riceve soltanto ciò che gli mancava, fuori dalla sua history, e la battuta
/// resta sua e annullabile. Soltanto se le due modifiche si toccano vince il
/// testo autorevole, senza coprire la battuta arrivata altrove.
export function written(paneId: string, change: EditorChange, from?: string): void {
  // Il documento che il riquadro mostra: durante un cambio di tab la scheda
  // attiva è già l'altra, e il testo registrato allo stacco è di questo.
  // Una superficie che nomina il suo documento e non è più davanti (un
  // foglio da parte che finisce di confermare una formula) scrive in quello:
  // il riquadro mostra già un'altra scheda. La sessione controlla comunque il
  // testo di prima; se è rimasta indietro, la superficie riceve ciò che la
  // sessione ha quando torna davanti (`unparkSurface`).
  const shown = panes.get(paneId)?.shown;
  if (from !== undefined && !(shown?.k === "doc" && shown.doc === from)) {
    documentSessions.acceptSurfaceChange(from, paneId, change);
    return;
  }
  const doc = shown?.k === "doc" ? shown.doc : activeDoc(paneId);
  if (!doc) return;
  const outcome = documentSessions.acceptSurfaceChange(doc, paneId, change);
  if (outcome.kind !== "realigned") return;
  const source = panes.get(paneId);
  const rebased = rebaseStaleChange(outcome.text, change);
  if (rebased && documentSessions.acceptSurfaceChange(doc, paneId, rebased).kind === "accepted") {
    if (source?.shown?.k === "doc" && source.shown.doc === doc) {
      source.surface?.buffer?.syncDoc({ text: rebased.text, operation: rebased.catchUp });
    }
    return;
  }
  if (source?.shown?.k === "doc" && source.shown.doc === doc) {
    source.surface?.buffer?.syncDoc(outcome.text);
  }
}

export async function applyExternalChange(id: string, outcome: ExternalChangeResult): Promise<void> {
  if (outcome.kind === "echo") return;
  // La nota cambiata da fuori mentre «Modifiche non salvate» chiede: la
  // domanda è vecchia, si ritira e la nota torna (`keepOrDiscardUnsaved`).
  // Solo per i fatti che la rendono vecchia: un testo nuovo sotto quello non
  // salvato (il conflitto, da mostrare subito) o una rilettura che ha cambiato
  // il testo. Una lettura fallita, un'eco tardiva o un file che nessuno segue
  // non cambiano ciò che la persona sta scegliendo.
  if (outcome.kind === "warning") {
    withdrawUnsavedQuestion(id, { kind: "reopen", doc: id, conflict: true });
  } else if (outcome.kind === "reloaded" && outcome.changed) {
    withdrawUnsavedQuestion(id, { kind: "reopen", doc: id, conflict: false });
  }
  invalidateDocumentCaches(id);
  if (outcome.kind === "warning") {
    // Già in conflitto, la barra lo dice: il fatto nuovo è lo stesso fatto.
    // Altrimenti la fascia del foglio lo dice a chi guarda la nota, e un
    // avviso a galla a chi non la vede, uno per nota.
    if (documentSessions.saveState(id) !== "conflitto") {
      const overwritten = outcome.cause === "altra_app";
      addSheetNotice(id, overwritten ? "overwritten" : "changed_on_disk");
      if (!docOnScreen(id)) {
        showStateNotice(
          id,
          "outside",
          (name) => t(overwritten ? "document.overwritten" : "document.changed_on_disk", { doc: pageName(name) }),
          (message) => notify(message, overwritten ? "guasto" : "info"),
          "change",
        );
      }
    }
    drawPaneConflict(id);
  } else if (outcome.kind === "untracked") {
    return;
  } else if (outcome.kind === "reloaded" && outcome.changed && !outcome.quiet) {
    // `quiet`: la scrittura di un gesto della barra di una Base, annunciata
    // con `expectWrite`. Il file nuovo è quello che la persona ha chiesto.
    addSheetNotice(id, "reloaded");
    drawPaneConflict(id);
  }
  // L'editor, quando il testo autorevole è cambiato, è già stato allineato
  // dalla sessione, che lo ha diffuso alle sue superfici. La lettura segue
  // col suo refresh dal buffer corrente.
  redrawReading(id);
}

export async function reloadDocument(id: string): Promise<void> {
  await documentSessions.reloadIfClean(id);
  redrawReading(id);
}

/// Mette la scheda attiva di un riquadro nella vista sorgente, o la riporta
/// alla superficie del documento con `null`, e porta il fuoco sulla
/// superficie nuova: quella di prima non c'è più, e il fuoco che stava dentro
/// di lei finirebbe sul corpo della pagina, dove chi usa la tastiera o un
/// lettore di schermo perde il punto.
///
/// La vista sorgente si apre per scrivere: se il riquadro ricorda una lettura
/// per la sua famiglia (una nota lasciata in Lettura), si passa alla scrittura
/// che il toggle sceglierebbe, invece di mostrare un'altra resa a chi ha
/// chiesto il testo. Con `context` si passa invece alla modalità che ha quel
/// ruolo, se la vista ne ha una.
export async function showSourceView(id: string, view: SourceView | null, context?: PaneMode): Promise<void> {
  const p = paneState(id);
  if (!p || p.active < 0) return;
  setTabOverride(id, p.active, view);
  await synchronize();
  const r = panes.get(id);
  if (view && r?.surface && layout.focus === id && context) {
    const target = modeForContext(r.surface.modes, selectedMode(r)?.id, context);
    if (target && target.id !== selectedMode(r)?.id) await setMode(target.id);
  } else if (view && r?.surface && layout.focus === id && selectedMode(r)?.contextMode === "reading") {
    const { family, modes, defaultMode } = r.surface;
    const writing = readingToggleTarget(modes, selectedMode(r)?.id, writingModes.get(id)?.get(family), defaultMode);
    if (writing) await setMode(writing.id);
  }
  await publishContext();
  if (layout.focus === id) panes.get(id)?.surface?.focus?.();
}

/// `Mod-s`: il salvataggio è automatico, ma chi lo chiede vuole saperlo fatto
/// adesso — e dopo un guasto è il gesto che riprova.
export async function saveNow(): Promise<void> {
  const pending = await flushPendingSave();
  view.drawSave();
  if (pending.length > 0) {
    notify(t("document.save_now_failed", { doc: pending.map(pageName).join(", ") }), "guasto");
  }
}
