// Stato autorevole e protocollo di persistenza di un documento aperto.
//
// Un `DocumentSession` è una sola istanza per documento: possiede il testo,
// l'origine della scrittura, la coda e i due debounce. Il pannello possiede le
// superfici e osserva soltanto eventi e snapshot immutabili.
import { api as defaultApi } from "../host/ipc";
import type { DraftInfo, Origin, WriteBase } from "../host/contract";
import { Queue } from "../ui/race";
import {
  consumeUnderChange,
  failureOutcome,
  stateOf,
  writeCountingEcho,
  type Outcome,
  type SaveState,
} from "./saving";
import { rejoinDrafts, type DraftBuffer, type DraftBufferStore } from "./drafts";
import { renameNote } from "./vault";
import { tryApplyOperation, type TextOperation } from "../editor/text-operation";

const SAVE_MS = 400;
const DRAFT_MS = 1_000;

/// La porta con cui una superficie si sottoscrive a una sessione. Soltanto
/// dati: niente DOM, niente editor, niente cursore, selezione o history —
/// ciò che la superficie fa del dato ricevuto resta tutto suo.
export interface DocumentSurface {
  /// Identità stabile e opaca della registrazione. Due registrazioni con la
  /// stessa identità sono la stessa superficie rimontata, non due superfici.
  readonly id: string;
  /// Il dato autorevole da applicare. Sincrono: la sessione non aspetta
  /// niente da chi lo riceve.
  sync(update: DocumentSurfaceUpdate): void;
}

/// Ciò che la sessione diffonde alle superfici: o l'operazione tipizzata
/// appena accettata (ai **pari** della sorgente), o il testo autorevole per
/// intero (una sostituzione esterna: ricarica pulita, conflitto, bozza).
export type DocumentSurfaceUpdate =
  | { kind: "operation"; text: string; operation: TextOperation }
  | { kind: "text"; text: string };

/// Una modifica dell'editor ridotta ai soli dati che la sessione valida.
export interface SurfaceEdit {
  readonly text: string;
  readonly operation: TextOperation;
}

/// Esito di una modifica portata da una superficie: accettata (e diffusa ai
/// pari), oppure respinta col testo autorevole a cui la sorgente si
/// riallinea, senza che la sessione abbia mutato nulla.
export type SurfaceChangeResult =
  | { kind: "accepted" }
  | { kind: "realigned"; text: string }
  | { kind: "untracked" };

export interface DocumentSessionApi {
  readDocument(id: string): Promise<{ text: string; revision: string }>;
  writeDocument(id: string, text: string, base: WriteBase): Promise<string>;
  saveDraft(id: string, text: string, base: string | null): Promise<void>;
  discardDraft(id: string): Promise<void>;
}

export interface DocumentSessionSnapshot {
  readonly id: string;
  readonly text: string;
  readonly base: WriteBase;
  readonly dirty: boolean;
  readonly result: Outcome;
  readonly saveState: SaveState | null;
  readonly echoes: number;
  readonly suspended: boolean;
  readonly pendingDeletion: boolean;
  readonly lifecycle: "open" | "closed";
}

export type ExternalChangeResult =
  | { kind: "untracked" }
  | { kind: "echo" }
  | { kind: "warning"; cause: "altra_app" | "riscrittura" }
  | { kind: "reloaded"; text: string; changed: boolean }
  | { kind: "stale" }
  | { kind: "unavailable" };

export type ReloadResult =
  | { kind: "missing" }
  | { kind: "dirty" }
  | { kind: "reloaded"; text: string; changed: boolean }
  | { kind: "stale" }
  | { kind: "unavailable" };
type DiskReloadResult = Exclude<ReloadResult, { kind: "missing" } | { kind: "dirty" }>;

export type ConflictResolutionResult =
  | { kind: "none" }
  | { kind: "kept" }
  | { kind: "discarded"; reload: ReloadResult; draft: "discarded" | "preserved" };

export type RenameResult =
  | { kind: "renamed"; from: string; to: string }
  | { kind: "already-renamed"; from: string; to: string }
  | { kind: "missing"; from: string; to: string }
  | { kind: "collision"; from: string; to: string };

export type DeletionResult =
  | { kind: "deleted"; dirty: boolean }
  | { kind: "ignored" };
export type CloseResult =
  | { kind: "closed"; dirty: boolean }
  | { kind: "active" }
  | { kind: "missing" };

export type ExternalRemovalResult = { kind: "removed"; dirty: boolean };

export type ConflictChoice = "mine" | "theirs";
export type DocumentSessionEvent =
  | { kind: "changed"; id: string }
  | { kind: "saved"; id: string }
  | { kind: "save-failed"; id: string; error: unknown; outcome: "conflitto" | "fallito" }
  | { kind: "draft-blind"; id: string }
  | { kind: "draft-discard-failed"; id: string; error: unknown }
  | { kind: "deletion-changed"; id: string; pending: boolean };

type SessionListener = (event: DocumentSessionEvent) => void | Promise<void>;
type DocumentSessionObserverFault =
  | {
      readonly kind: "listener";
      readonly event: DocumentSessionEvent;
      readonly error: unknown;
    }
  | {
      readonly kind: "surface";
      readonly documentId: string;
      readonly surfaceId: string;
      readonly update: DocumentSurfaceUpdate;
      readonly error: unknown;
    };

type SessionHooks = {
  emit(event: DocumentSessionEvent): void | Promise<void>;
  reportObserverFault(fault: DocumentSessionObserverFault): void;
  draftSucceeded(): void;
  draftFailed(id: string): void;
};

interface SessionState {
  text: string;
  base: WriteBase;
  dirty: boolean;
  result: Outcome;
  echoes: number;
  suspended: boolean;
  pendingDeletion: boolean;
  lifecycle: "open" | "closed";
}

interface DraftWork {
  readonly id: string;
  readonly generation: number;
  readonly promise: Promise<void>;
}

interface DraftOutcome {
  readonly generation: number;
  readonly succeeded: boolean;
}

interface AuthoritativeReload {
  readonly id: string;
  readonly externalGeneration: number;
  readonly activityGeneration: number;
  readonly authorityGeneration: number;
}

type DraftDropResult = "discarded" | "preserved";

const OWNER_TOKEN = Symbol("DocumentSession owner");
type OwnerToken = typeof OWNER_TOKEN;

function copyBase(base: WriteBase): WriteBase {
  return base.kind === "dictated"
    ? { kind: "dictated" }
    : { kind: "descends_from", value: base.value };
}

class DocumentDeletedDuringRead extends Error {
  constructor(id: string) {
    super(`document ${id} was deleted while it was loading`);
    this.name = "DocumentDeletedDuringRead";
  }
}

function failDeletedRead(id: string): never {
  throw new DocumentDeletedDuringRead(id);
}

export function isDocumentDeletedDuringRead(error: unknown): boolean {
  return error instanceof DocumentDeletedDuringRead;
}

/** The per-document owner. Its constructor is guarded by the collection token. */
export class DocumentSession implements DraftBuffer {
  #id: string;
  #state: SessionState;
  #queue = new Queue();
  #saveTimer: number | undefined;
  #draftTimer: number | undefined;
  #draftGeneration = 0;
  #draftWork: DraftWork | undefined;
  #draftOutcome: DraftOutcome | undefined;
  #externalGeneration = 0;
  #activityGeneration = 0;
  #authorityGeneration = 0;
  #diskAuthorityUnknown = false;
  readonly #api: DocumentSessionApi;
  readonly #hooks: SessionHooks;
  /// Le superfici sottoscritte, per identità di registrazione. È ownership di
  /// ciclo di vita, non un registro di famiglie: chi si toglie chiude, la
  /// chiusura della sessione chiude tutti.
  readonly #surfaces = new Map<string, DocumentSurface>();

  constructor(
    token: OwnerToken,
    id: string,
    text: string,
    base: WriteBase,
    api: DocumentSessionApi,
    hooks: SessionHooks,
  ) {
    if (token !== OWNER_TOKEN) throw new Error("DocumentSession must be created by its owner");
    this.#id = id;
    this.#state = {
      text,
      base: copyBase(base),
      dirty: false,
      result: "ok",
      echoes: 0,
      suspended: false,
      pendingDeletion: false,
      lifecycle: "open",
    };
    this.#api = api;
    this.#hooks = hooks;
  }

  get dirty(): boolean {
    return this.#state.dirty;
  }

  get id(): string {
    return this.#id;
  }

  text(): string {
    return this.#state.text;
  }

  result(): Outcome {
    return this.#state.result;
  }

  saveState(): SaveState | null {
    return stateOf(this.#state);
  }

  snapshot(): DocumentSessionSnapshot {
    return {
      id: this.#id,
      text: this.#state.text,
      base: copyBase(this.#state.base),
      dirty: this.#state.dirty,
      result: this.#state.result,
      saveState: this.saveState(),
      echoes: this.#state.echoes,
      suspended: this.#state.suspended,
      pendingDeletion: this.#state.pendingDeletion,
      lifecycle: this.#state.lifecycle,
    };
  }
  activityGeneration(): number {
    return this.#activityGeneration;
  }

  retain(): void {
    if (this.#isOpen()) this.#activityGeneration++;
  }

  /**
   * The validated surface path is the only production mutation entry. This
   * helper keeps the mutation itself private while programmatic replacement
   * paths continue to use `restoreDraft`/`syncDoc` without a fake operation.
   */
  #acceptTextChange(text: string): void {
    if (!this.#isOpen() || this.#state.pendingDeletion) return;
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#state.text = text;
    this.#state.dirty = true;
    // Persistence is armed before observers are notified. Their faults are
    // isolated per recipient and cannot reject or undo the accepted edit.
    this.scheduleSave();
    this.scheduleDraft();
    this.#emit({ kind: "changed", id: this.#id });
  }

  /**
   * Una superficie porta la sua operazione tipizzata. La sessione è l'unico
   * posto che la valida: preimage e risultato si misurano sul testo
   * autorevole (sulla stessa normalizzazione di terminatori che poi applica
   * il motore). Respingere non muta niente: la sorgente riceve il testo
   * autorevole e si riallinea da sé. Accettare aggiorna una volta, programma
   * salvataggio e bozza, e diffonde l'operazione a tutti i pari **tranne la
   * sorgente** — che la sua editor ce l'ha già.
   */
  acceptSurfaceChange(surfaceId: string, edit: SurfaceEdit): SurfaceChangeResult {
    if (!this.#isOpen()) return { kind: "untracked" };
    // A pending destructive command makes every editor read-only. Keep the
    // authoritative buffer untouched even if a stale adapter callback arrives.
    if (this.#state.pendingDeletion) return { kind: "realigned", text: this.#state.text };
    // I due `replace` sono lo stesso lavello: preimage e atteso devono essere
    // normalizzati identicamente, o la validazione regge per caso.
    const expected = edit.text.replace(/\r\n?/g, "\n");
    const applied = tryApplyOperation(this.#state.text.replace(/\r\n?/g, "\n"), edit.operation);
    if (applied.kind !== "applied" || applied.text !== expected) {
      return { kind: "realigned", text: this.#state.text };
    }
    this.#acceptTextChange(edit.text);
    this.#fanOut({ kind: "operation", text: edit.text, operation: edit.operation }, surfaceId);
    return { kind: "accepted" };
  }

  /**
   * Attacca una superficie a questa sessione. L'identità è la chiave: la
   * stessa registrazione attaccata due volte resta una sola sottoscrizione,
   * una rimontata con la stessa identità rimpiazza la precedente. Il disposer
   * è indempiente e stacca soltanto la registrazione che gli è stata data.
   */
  attachSurface(surface: DocumentSurface): () => void {
    if (!this.#isOpen()) return () => {};
    this.#surfaces.set(surface.id, surface);
    return () => {
      if (this.#surfaces.get(surface.id) === surface) this.#surfaces.delete(surface.id);
    };
  }

  restoreDraft(text: string, base: WriteBase): void {
    if (!this.#isOpen()) return;
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#clearDiskAuthorityBlock();
    this.#state.text = text;
    this.#state.base = copyBase(base);
    this.#state.dirty = true;
    this.#state.result = "ok";
    this.#state.echoes = 0;
    this.#emit({ kind: "changed", id: this.#id });
    this.#fanOut({ kind: "text", text });
  }

  /// Diffonde un dato autorevole alle superfici sottoscritte, esclusa
  /// l'eventuale sorgente. Una diffusione per dato accettato: chi riceve non
  /// ri-entra nella sessione (il motore marca il cambio come remoto).
  #fanOut(update: DocumentSurfaceUpdate, except?: string): void {
    for (const surface of this.#surfaces.values()) {
      if (surface.id === except) continue;
      try {
        surface.sync(update);
      } catch (error) {
        this.#hooks.reportObserverFault({
          kind: "surface",
          documentId: this.#id,
          surfaceId: surface.id,
          update,
          error,
        });
      }
    }
  }

  /** Consume an external event before applying the clean/dirty policy. */
  async handleExternalChange(source: Origin): Promise<ExternalChangeResult> {
    const externalGeneration = ++this.#externalGeneration;
    const activityGeneration = this.#activityGeneration;
    const underChange = consumeUnderChange(this.#state, source);
    if (underChange === "eco") return { kind: "echo" };
    if (underChange === "altra_app" || underChange === "riscrittura") {
      return { kind: "warning", cause: underChange };
    }
    return this.#reloadFromDisk(externalGeneration, activityGeneration);
  }

  /** Reread a clean document during event reconciliation. */
  async reloadIfClean(): Promise<ReloadResult> {
    if (!this.#isOpen()) return { kind: "missing" };
    if (this.#state.dirty) return { kind: "dirty" };
    return this.#reloadFromDisk(++this.#externalGeneration, this.#activityGeneration);
  }

  /** Reread a document after an explicit command invalidated the buffer. */
  async forceReload(): Promise<ReloadResult> {
    if (!this.#isOpen()) return { kind: "missing" };
    return (await this.#reloadAuthoritatively("force")).reload;
  }

  async resolveConflict(choice: ConflictChoice): Promise<ConflictResolutionResult> {
    if (!this.#isOpen() || this.#state.result !== "conflitto") return { kind: "none" };
    if (choice === "mine") {
      await this.saveKeepingMine();
      return { kind: "kept" };
    }
    const outcome = await this.#reloadAuthoritatively("theirs");
    return { kind: "discarded", ...outcome };
  }

  async #reloadAuthoritatively(
    kind: "force" | "theirs",
  ): Promise<{ reload: DiskReloadResult; draft: DraftDropResult }> {
    const reload = this.#beginAuthoritativeReload();
    let source: { text: string; revision: string };
    try {
      source = await this.#api.readDocument(reload.id);
    } catch {
      if (!this.#isCurrentAuthoritativeReload(reload)) {
        this.#markAuthoritativeReloadUnavailable(kind, reload);
        return { reload: { kind: "stale" }, draft: "preserved" };
      }
      this.#markAuthoritativeReloadUnavailable(kind, reload);
      return { reload: { kind: "unavailable" }, draft: "preserved" };
    }
    if (!this.#isCurrentAuthoritativeReload(reload)) {
      this.#markAuthoritativeReloadUnavailable(kind, reload);
      return { reload: { kind: "stale" }, draft: "preserved" };
    }
    const changed = this.#commitAuthoritativeReload(source.text, source.revision);
    const draftGeneration = this.#draftGeneration;
    const draft = await this.#dropDraft(reload.id, draftGeneration);
    return {
      reload: { kind: "reloaded", text: source.text, changed },
      draft,
    };
  }

  #beginAuthoritativeReload(): AuthoritativeReload {
    const id = this.#id;
    const externalGeneration = ++this.#externalGeneration;
    const activityGeneration = ++this.#activityGeneration;
    const authorityGeneration = ++this.#authorityGeneration;
    this.#diskAuthorityUnknown = true;
    this.#clearSaveTimer();
    return { id, externalGeneration, activityGeneration, authorityGeneration };
  }

  #isCurrentAuthoritativeReload(reload: AuthoritativeReload): boolean {
    return (
      this.#isOpen() &&
      this.#id === reload.id &&
      this.#externalGeneration === reload.externalGeneration &&
      this.#activityGeneration === reload.activityGeneration &&
      this.#authorityGeneration === reload.authorityGeneration
    );
  }

  #markAuthoritativeReloadUnavailable(kind: "force" | "theirs", reload: AuthoritativeReload): void {
    if (
      !this.#isOpen() ||
      this.#id !== reload.id ||
      this.#authorityGeneration !== reload.authorityGeneration ||
      !this.#diskAuthorityUnknown
    ) {
      return;
    }
    if (
      kind === "force" &&
      this.#state.result !== "conflitto" &&
      this.#state.result !== "fallito"
    ) {
      this.#state.result = "fallito";
      this.#emit({ kind: "changed", id: this.#id });
    }
  }

  #commitAuthoritativeReload(text: string, revision: string): boolean {
    const changed = this.#state.text !== text;
    const stateChanged =
      changed ||
      this.#state.dirty ||
      this.#state.result !== "ok" ||
      this.#state.echoes !== 0;
    this.#state.text = text;
    this.#state.base = { kind: "descends_from", value: revision };
    this.#state.dirty = false;
    this.#state.result = "ok";
    this.#state.echoes = 0;
    this.#draftGeneration++;
    this.#clearDraftTimer();
    this.#clearDiskAuthorityBlock();
    if (stateChanged) this.#emit({ kind: "changed", id: this.#id });
    this.#fanOut({ kind: "text", text });
    return changed;
  }

  #reloadFromDisk(
    externalGeneration: number,
    activityGeneration: number,
  ): Promise<DiskReloadResult> {
    const id = this.#id;
    return this.#api.readDocument(id).then(
      (source) => {
        if (
          !this.#isOpen() ||
          this.#id !== id ||
          this.#externalGeneration !== externalGeneration ||
          this.#activityGeneration !== activityGeneration ||
          this.#state.dirty
        ) {
          return { kind: "stale" as const };
        }
        const changed = this.#applyCleanReload(source.text, source.revision);
        return { kind: "reloaded" as const, text: this.#state.text, changed };
      },
      () => {
        if (
          !this.#isOpen() ||
          this.#id !== id ||
          this.#externalGeneration !== externalGeneration ||
          this.#activityGeneration !== activityGeneration ||
          this.#state.dirty
        ) {
          return { kind: "stale" as const };
        }
        return { kind: "unavailable" as const };
      },
    );
  }

  #applyCleanReload(text: string, revision: string): boolean {
    if (!this.#isOpen() || this.#state.dirty) return false;
    const changed = this.#state.text !== text;
    const resultChanged = this.#state.result !== "ok";
    this.#state.base = { kind: "descends_from", value: revision };
    this.#state.result = "ok";
    if (changed) this.#state.text = text;
    if (changed) this.#draftGeneration++;
    this.#clearDiskAuthorityBlock();
    if (changed || resultChanged) this.#emit({ kind: "changed", id: this.#id });
    // Ricarica pulita: il testo è stato sostituito dall'autorità, e tutte le
    // superfici lo ricevono una volta, per intero, senza una sorgente da
    // escludere.
    if (changed) this.#fanOut({ kind: "text", text });
    return changed;
  }

  #clearDiskAuthorityBlock(): void {
    if (!this.#diskAuthorityUnknown) return;
    this.#diskAuthorityUnknown = false;
    this.#authorityGeneration++;
  }
  scheduleSave(): void {
    if (
      !this.#isOpen() ||
      this.#state.suspended ||
      this.#state.pendingDeletion ||
      this.#diskAuthorityUnknown
    ) {
      return;
    }
    if (this.#state.result === "conflitto") return;
    this.#clearSaveTimer();
    const id = this.#id;
    this.#saveTimer = window.setTimeout(() => {
      this.#saveTimer = undefined;
      void this.#saveNow(id);
    }, SAVE_MS);
  }

  scheduleDraft(): void {
    if (!this.#isOpen() || this.#state.suspended || this.#state.pendingDeletion) return;
    this.#clearDraftTimer();
    const id = this.#id;
    this.#draftTimer = window.setTimeout(() => {
      this.#draftTimer = undefined;
      void this.#writeDraft(id);
    }, DRAFT_MS);
  }

  async flush(): Promise<boolean> {
    if (!this.#isOpen() || !this.#state.dirty) return false;
    this.#clearSaveTimer();
    const id = this.#id;
    await this.#saveNow(id);
    return this.#state.dirty;
  }

  async flushDraft(): Promise<void> {
    this.#clearDraftTimer();
    await this.#writeDraft(this.#id);
  }

  cancelDraftTimer(): void {
    this.#clearDraftTimer();
  }

  isDeletionPending(): boolean {
    return this.#isOpen() && this.#state.pendingDeletion;
  }

  beginDeletion(): boolean {
    if (!this.#isOpen() || this.#state.pendingDeletion) return false;
    this.#activityGeneration++;
    this.#state.pendingDeletion = true;
    this.#state.suspended = true;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#emit({ kind: "deletion-changed", id: this.#id, pending: true });
    return true;
  }

  cancelDeletion(): void {
    if (!this.#isOpen() || !this.#state.pendingDeletion) return;
    this.#activityGeneration++;
    this.#state.pendingDeletion = false;
    this.#state.suspended = false;
    if (this.#state.dirty) {
      this.scheduleSave();
      this.scheduleDraft();
    }
    this.#emit({ kind: "deletion-changed", id: this.#id, pending: false });
  }

  suspend(): boolean {
    if (!this.#isOpen()) return false;
    this.#activityGeneration++;
    this.#state.suspended = true;
    const dirty = this.#state.dirty;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    return dirty;
  }
  resume(): void {
    if (!this.#isOpen() || !this.#state.suspended || this.#state.pendingDeletion) return;
    this.#activityGeneration++;
    this.#state.suspended = false;
    if (!this.#state.dirty) return;
    this.scheduleSave();
    this.scheduleDraft();
  }


  /**
   * Close before running a destructive command, then discard its draft in the
   * same per-session queue. A failed command reopens the exact old session —
   * con le sue superfici: la chiusura qui è provvisoria, e staccarle sarebbe
   * un licenziamento che al ritorno non si ritira.
   */
  async delete(run: (id: string) => Promise<void>): Promise<boolean> {
    if (!this.#isOpen()) return false;
    if (!this.#state.pendingDeletion) {
      if (!this.beginDeletion()) return false;
    }
    if (!this.#closeState(true)) return false;
    const closeActivity = this.#activityGeneration;
    const id = this.#id;
    try {
      await this.#queue.enqueue(() => run(id));
      await this.#dropDraft(id);
    } catch (error) {
      if (
        this.#state.lifecycle === "closed" &&
        this.#activityGeneration === closeActivity
      ) {
        this.#reopen();
      }
      throw error;
    }
    this.#surfaces.clear();
    return true;
  }

  /** Drop a draft after an external deletion already closed this session. */
  async discardDraftAfterClose(): Promise<void> {
    this.#clearDraftTimer();
    await this.#dropDraft(this.#id);
  }

  async saveKeepingMine(): Promise<void> {
    if (!this.#isOpen() || this.#state.result !== "conflitto") return;
    this.#activityGeneration++;
    this.#clearSaveTimer();
    this.#clearDiskAuthorityBlock();
    this.#draftGeneration++;
    this.#state.base = { kind: "dictated" };
    this.#state.result = "in_corso";
    this.#emit({ kind: "changed", id: this.#id });
    await this.#saveNow(this.#id);
  }
  rename(id: string): void {
    if (!this.#isOpen() || id === this.#id) return;
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#clearDiskAuthorityBlock();
    this.#id = id;
    if (!this.#state.pendingDeletion) this.#state.suspended = false;
    if (this.#state.dirty) {
      this.scheduleSave();
      this.scheduleDraft();
    }
  }

  close(force = false): boolean {
    if (!this.#isOpen()) return false;
    if (!force && this.#state.pendingDeletion) return false;
    if (!this.#closeState(force)) return false;
    // La chiusura è definitiva: nessuna superficie deve restare sottoscritta
    // a una sessione che non esiste più.
    this.#surfaces.clear();
    return true;
  }

  #closeState(force = false): boolean {
    if (!force && this.#state.pendingDeletion) return false;
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#clearDiskAuthorityBlock();
    this.#state.suspended = false;
    this.#state.pendingDeletion = false;
    this.#state.lifecycle = "closed";
    return true;
  }

  #reopen(): void {
    if (this.#state.lifecycle !== "closed") return;
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#state.lifecycle = "open";
    this.#state.suspended = false;
    this.#state.pendingDeletion = false;
    if (this.#state.dirty) {
      this.scheduleSave();
      this.scheduleDraft();
    }
    this.#emit({ kind: "deletion-changed", id: this.#id, pending: false });
  }
  #isOpen(): boolean {
    return this.#state.lifecycle === "open";
  }

  #emit(event: DocumentSessionEvent): void | Promise<void> {
    return this.#hooks.emit(event);
  }

  #clearSaveTimer(): void {
    if (this.#saveTimer === undefined) return;
    window.clearTimeout(this.#saveTimer);
    this.#saveTimer = undefined;
  }

  #clearDraftTimer(): void {
    if (this.#draftTimer === undefined) return;
    window.clearTimeout(this.#draftTimer);
    this.#draftTimer = undefined;
  }

  #saveNow(id: string): Promise<void> {
    if (!this.#isOpen() || this.#state.pendingDeletion || this.#diskAuthorityUnknown) {
      return Promise.resolve();
    }
    return this.#queue.enqueue(() => this.#writeBuffer(id));
  }

  async #writeBuffer(id: string): Promise<void> {
    if (
      !this.#isOpen() ||
      this.#state.suspended ||
      this.#state.pendingDeletion ||
      this.#diskAuthorityUnknown ||
      this.#id !== id ||
      !this.#state.dirty
    ) return;
    const authorityGeneration = this.#authorityGeneration;
    const text = this.#state.text;
    const base = copyBase(this.#state.base);
    this.#state.result = "in_corso";
    this.#emit({ kind: "changed", id });

    let produced: string;
    try {
      produced = await writeCountingEcho(this.#state, () => this.#api.writeDocument(id, text, base));
    } catch (error) {
      if (
        !this.#isOpen() ||
        this.#id !== id ||
        this.#diskAuthorityUnknown ||
        this.#authorityGeneration !== authorityGeneration
      ) {
        return;
      }
      const outcome = failureOutcome(error);
      this.#state.result = outcome;
      this.#clearDraftTimer();
      void this.#writeDraft(this.#id);
      this.#emit({ kind: "save-failed", id: this.#id, error, outcome });
      return;
    }

    if (
      !this.#isOpen() ||
      this.#id !== id ||
      this.#diskAuthorityUnknown ||
      this.#authorityGeneration !== authorityGeneration
    ) {
      return;
    }
    const changed = this.#state.text !== text;
    this.#state.result = "ok";
    this.#state.base = { kind: "descends_from", value: produced };
    if (changed) {
      // The newer dirty text now descends from the revision just written.
      // Any draft queued before that write captured the old base.
      this.#draftGeneration++;
    } else {
      this.#state.dirty = false;
      void this.#dropDraft(this.#id);
    }
    await this.#emit({ kind: "saved", id: this.#id });
  }

  #writeDraft(id: string): Promise<void> {
    if (
      !this.#isOpen() ||
      this.#state.suspended ||
      this.#state.pendingDeletion ||
      this.#id !== id ||
      !this.#state.dirty
    ) {
      return Promise.resolve();
    }
    const generation = this.#draftGeneration;
    const pending = this.#draftWork;
    if (pending?.id === id && pending.generation === generation) return pending.promise;
    if (this.#draftOutcome?.generation === generation && this.#draftOutcome.succeeded) {
      return Promise.resolve();
    }

    const promise = this.#queue.enqueue(async () => {
      if (
        !this.#isOpen() ||
        this.#state.suspended ||
        this.#state.pendingDeletion ||
        this.#id !== id ||
        !this.#state.dirty ||
        this.#draftGeneration !== generation
      ) {
        return;
      }
      const text = this.#state.text;
      const base = this.#state.base.kind === "descends_from" ? this.#state.base.value : null;
      try {
        await this.#api.saveDraft(id, text, base);
        if (
          !this.#isOpen() ||
          this.#id !== id ||
          this.#draftGeneration !== generation
        ) {
          return;
        }
        this.#draftOutcome = { generation, succeeded: true };
        this.#hooks.draftSucceeded();
      } catch {
        if (
          !this.#isOpen() ||
          this.#id !== id ||
          this.#draftGeneration !== generation
        ) {
          return;
        }
        this.#draftOutcome = { generation, succeeded: false };
        this.#hooks.draftFailed(id);
      }
    });
    const work: DraftWork = { id, generation, promise };
    this.#draftWork = work;
    void promise.then(
      () => {
        if (this.#draftWork === work) this.#draftWork = undefined;
      },
      () => {
        if (this.#draftWork === work) this.#draftWork = undefined;
      },
    );
    return promise;
  }

  #dropDraft(id: string, expectedGeneration?: number): Promise<DraftDropResult> {
    if (
      this.#id !== id ||
      (expectedGeneration !== undefined &&
        (this.#draftGeneration !== expectedGeneration || this.#state.dirty))
    ) {
      return Promise.resolve("preserved");
    }
    return this.#queue.enqueue(async () => {
      if (
        this.#id !== id ||
        (expectedGeneration !== undefined &&
          (this.#draftGeneration !== expectedGeneration || this.#state.dirty))
      ) {
        return "preserved";
      }
      try {
        await this.#api.discardDraft(id);
        return "discarded";
      } catch (error) {
        await this.#emit({ kind: "draft-discard-failed", id, error });
        return "preserved";
      }
    });
  }
}

/** The sole collection and construction path for document sessions. */
export class DocumentSessionCollection implements DraftBufferStore {
  readonly #api: DocumentSessionApi;
  readonly #sessions = new Map<string, DocumentSession>();
  readonly #listeners = new Set<SessionListener>();
  readonly #identityVersions = new Map<string, number>();
  readonly #renaming = new Set<string>();
  readonly #deletions = new Map<string, Promise<DeletionResult>>();
  /// Aliases for an owner whose confirmation survives a rename. The pending
  /// bit itself remains owned by `DocumentSession`; this index only lets the
  /// original path resolve that same owner until cancellation/failure/success.
  readonly #pendingDeletionOwners = new Map<string, DocumentSession>();
  /// Counts deletion attempts so a release already waiting on the old owner
  /// can retry after a failed deletion reopens that same owner.
  readonly #deletionVersions = new Map<string, number>();
  #blindDraft = false;
  /// A pending open reserves this owner before any flush/read `await`.
  readonly #openIntents = new Map<string, number>();

  constructor(api: DocumentSessionApi = defaultApi) {
    this.#api = api;
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get(id: string): DocumentSession | undefined {
    return this.#sessions.get(id);
  }

  inspect(id: string): DocumentSessionSnapshot | undefined {
    return this.#sessions.get(id)?.snapshot();
  }

  text(id: string): string | undefined {
    return this.#sessions.get(id)?.text();
  }

  isDirty(id: string): boolean {
    return this.#sessions.get(id)?.dirty === true;
  }
  isDeletionPending(id: string): boolean {
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    return session?.isDeletionPending() === true;
  }

  saveState(id: string): SaveState | null {
    return this.#sessions.get(id)?.saveState() ?? null;
  }
  /**
   * Reserve an opening before the panel waits for the shared save queue.
   *
   * The reservation is also kept when no session exists yet: that is the
   * window in which a panel read may still be creating the owner. The returned
   * disposer is idempotent and is called by the opening path on both success
   * and failure.
   */
  retain(id: string): () => void {
    this.#sessions.get(id)?.retain();
    this.#openIntents.set(id, (this.#openIntents.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.#openIntents.get(id) ?? 0;
      if (count <= 1) this.#openIntents.delete(id);
      else this.#openIntents.set(id, count - 1);
    };
  }
  async handleExternalChange(id: string, source: Origin): Promise<ExternalChangeResult> {
    const session = this.#sessions.get(id);
    if (!session) return { kind: "untracked" };
    return session.handleExternalChange(source);
  }
  async reloadIfClean(id: string): Promise<ReloadResult> {
    return (await this.#sessions.get(id)?.reloadIfClean()) ?? { kind: "missing" };
  }

  async read(id: string): Promise<string> {
    const pendingDeletion = this.#deletions.get(id);
    if (pendingDeletion) {
      const outcome = await pendingDeletion;
      if (outcome.kind === "deleted") return failDeletedRead(id);
      return this.read(id);
    }
    const pendingOwner = this.#pendingDeletionOwners.get(id);
    if (pendingOwner?.isDeletionPending()) return pendingOwner.text();
    const existing = this.#sessions.get(id);
    if (existing?.snapshot().lifecycle === "open") {
      existing.retain();
      return existing.text();
    }
    const version = this.#identityVersion(id);
    const source = await this.#api.readDocument(id);
    const current = this.#sessions.get(id);
    if (current?.snapshot().lifecycle === "open") return current.text();
    const renamedPendingOwner = this.#pendingDeletionOwners.get(id);
    if (renamedPendingOwner?.isDeletionPending()) return renamedPendingOwner.text();
    const deletion = this.#deletions.get(id);
    if (deletion) {
      const outcome = await deletion;
      if (outcome.kind === "deleted") return failDeletedRead(id);
      return this.read(id);
    }
    if (this.#renaming.has(id) || this.#identityVersion(id) !== version) return source.text;
    return this.#create(id, source.text, { kind: "descends_from", value: source.revision }).text();
  }


  /**
   * Una superficie si sottoscrive alla sessione **unica** del documento. Non
   * c'è sessione, non c'è sottoscrizione: il disposer è comunque restituito,
   * così chi attacca non deve sapere se il documento era già aperto. Il
   * disposer copre solo la sessione a cui ha attaccato: una sessione nata
   * dopo sotto lo stesso id non perde la sua registrazione per un disposer
   * rimasto appeso.
   */
  attachSurface(id: string, surface: DocumentSurface): () => void {
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    if (!session) return () => {};
    const dispose = session.attachSurface(surface);
    return () => {
      // L'owner può cambiare chiave con una rinomina: si deve ancora poter
      // staccare la registrazione, ma mai una sessione nuova nata sotto l'id.
      if (this.#sessions.get(session.id) === session) dispose();
    };
  }

  /** La modifica di una superficie, validata e diffusa dalla sessione. */
  acceptSurfaceChange(id: string, surfaceId: string, edit: SurfaceEdit): SurfaceChangeResult {
    const session = this.#sessions.get(id);
    if (!session) return { kind: "untracked" };
    return session.acceptSurfaceChange(surfaceId, edit);
  }
  async forceReload(id: string): Promise<ReloadResult> {
    return (await this.#sessions.get(id)?.forceReload()) ?? { kind: "missing" };
  }

  restore(id: string, text: string, base: WriteBase): void {
    const session = this.#sessions.get(id) ?? this.#create(id, text, base);
    session.restoreDraft(text, base);
  }

  rejoin(drafts: DraftInfo[]): DraftInfo[] {
    const rejoined = rejoinDrafts(drafts, this);
    for (const draft of rejoined) this.#sessions.get(draft.doc)?.scheduleSave();
    return rejoined;
  }

  async flushPendingSave(): Promise<string[]> {
    const entries = [...this.#sessions.entries()];
    const outcomes = await Promise.all(
      entries.map(async ([id, session]) => {
        if (!session.dirty) return null;
        const dirty = await session.flush();
        return this.#sessions.get(id) === session && dirty ? id : null;
      }),
    );
    return outcomes.filter((id): id is string => id !== null);
  }

  async flush(id: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session) return false;
    const dirty = await session.flush();
    return this.#sessions.get(id) === session && dirty;
  }

  async flushDraft(id: string): Promise<void> {
    const session = this.#sessions.get(id);
    if (!session?.dirty) return;
    await session.flushDraft();
  }

  async flushBeforeClose(): Promise<void> {
    for (const session of this.#sessions.values()) session.cancelDraftTimer();
    const pending = await this.flushPendingSave();
    for (const id of pending) await this.#sessions.get(id)?.flushDraft();
  }

  beginDeletion(id: string): boolean {
    const session = this.#sessions.get(id);
    if (!session) return false;
    const started = session.beginDeletion();
    if (started) this.#rememberPendingOwner(id, session);
    return started;
  }

  cancelDeletion(id: string): void {
    const session = this.#pendingDeletionOwner(id);
    if (!session) return;
    session.cancelDeletion();
    if (!session.isDeletionPending()) this.#forgetPendingOwner(session);
  }

  async delete(id: string, run: (id: string) => Promise<void>): Promise<DeletionResult> {
    const pending =
      this.#deletions.get(id) ??
      (this.#pendingDeletionOwners.get(id)
        ? this.#deletions.get(this.#pendingDeletionOwners.get(id)!.id)
        : undefined);
    if (pending) {
      await pending;
      return { kind: "ignored" };
    }

    const session = this.#pendingDeletionOwner(id) ?? this.#sessions.get(id);
    if (session) this.#rememberPendingOwner(id, session);
    const aliases = session
      ? [...this.#pendingDeletionOwners.entries()]
          .filter(([, owner]) => owner === session)
          .map(([alias]) => alias)
      : [];
    if (!aliases.includes(id)) aliases.push(id);
    if (session && !aliases.includes(session.id)) aliases.push(session.id);
    for (const alias of aliases) {
      this.#deletionVersions.set(alias, this.#deletionVersion(alias) + 1);
      this.#invalidate(alias);
    }

    let settle!: (outcome: DeletionResult) => void;
    const reservation = new Promise<DeletionResult>((resolve) => {
      settle = resolve;
    });
    for (const alias of aliases) this.#deletions.set(alias, reservation);

    let outcome: DeletionResult | undefined;
    try {
      if (!session) {
        await run(id);
        try {
          await this.#api.discardDraft(id);
        } catch (error) {
          await this.#emit({ kind: "draft-discard-failed", id, error });
        }
        outcome = { kind: "deleted", dirty: false };
        return outcome;
      }

      const dirty = session.dirty;
      const deletion = session.delete(run);
      this.#sessions.delete(session.id);
      try {
        if (!(await deletion)) {
          outcome = { kind: "ignored" };
          return outcome;
        }
        outcome = { kind: "deleted", dirty };
        return outcome;
      } catch (error) {
        if (session.snapshot().lifecycle === "open") this.#sessions.set(session.id, session);
        throw error;
      }
    } finally {
      settle(outcome ?? { kind: "ignored" });
      for (const alias of aliases) {
        if (this.#deletions.get(alias) === reservation) this.#deletions.delete(alias);
      }
      if (session) this.#forgetPendingOwner(session);
    }
  }

  handleExternalRemoval(id: string): ExternalRemovalResult {
    this.#invalidate(id);
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    if (!session) return { kind: "removed", dirty: false };
    this.#invalidate(session.id);
    const dirty = session.dirty;
    session.close(true);
    if (this.#sessions.get(session.id) === session) this.#sessions.delete(session.id);
    this.#forgetPendingOwner(session);
    void session.discardDraftAfterClose();
    return { kind: "removed", dirty };
  }
  async release(id: string): Promise<CloseResult> {
    if ((this.#openIntents.get(id) ?? 0) > 0) return { kind: "active" };

    const pendingOwner = this.#pendingDeletionOwner(id);
    const deletingOwner = this.#pendingDeletionOwners.get(id);
    if (pendingOwner) return { kind: "active" };
    const deletionVersion = this.#deletionVersion(id);
    const pendingDeletion =
      this.#deletions.get(id) ??
      (deletingOwner ? this.#deletions.get(deletingOwner.id) : undefined);
    if (pendingDeletion) {
      const ownerId = deletingOwner?.id ?? id;
      const outcome = await pendingDeletion;
      if (outcome.kind === "deleted") return { kind: "missing" };
      // A failed deletion reopened the exact old owner. Re-run the release
      // decision against that owner instead of leaving it unwatched.
      return this.release(ownerId);
    }

    const session = this.#sessions.get(id);
    if (!session) {
      // A panel can finish its last render after its tab has gone away. Bump
      // identity even without an owner so that the in-flight read cannot
      // create an orphan session when it resolves.
      this.#invalidate(id);
      return { kind: "missing" };
    }

    const activity = session.activityGeneration();
    await session.flush();
    if (session.dirty) await session.flushDraft();

    if (session.isDeletionPending()) return { kind: "active" };
    if (this.#sessions.get(id) !== session) {
      const pending = this.#deletions.get(id) ?? this.#deletions.get(session.id);
      if (pending) {
        const outcome = await pending;
        if (outcome.kind === "deleted") return { kind: "missing" };
        return this.release(session.id);
      }
      // A rename can move this owner while it is being flushed. If no newer
      // owner replaced it, continue the same close decision under its key.
      if (session.id !== id && this.#sessions.get(session.id) === session) {
        return this.release(session.id);
      }
      return { kind: "missing" };
    }
    if ((this.#openIntents.get(id) ?? 0) > 0) return { kind: "active" };
    if (this.#deletionVersion(id) !== deletionVersion) {
      // The deletion failed after this release started; its reopen activity is
      // internal, so retry once rather than treating it as a user reopen.
      if (this.#sessions.get(id) === session && session.snapshot().lifecycle === "open") {
        return this.release(id);
      }
      return { kind: "missing" };
    }
    if (session.activityGeneration() !== activity) return { kind: "active" };
    return this.close(id);
  }

  async resolveConflict(id: string, choice: ConflictChoice): Promise<ConflictResolutionResult> {
    return (await this.#sessions.get(id)?.resolveConflict(choice)) ?? { kind: "none" };
  }
  async renameKeepingBuffer(from: string, to: string): Promise<RenameResult> {
    const pendingAlias = this.#pendingDeletionOwners.get(from);
    const session =
      this.#sessions.get(from) ??
      (pendingAlias?.snapshot().lifecycle === "open" ? pendingAlias : undefined);
    const target = this.#sessions.get(to);
    if (target && target !== session) return { kind: "collision", from, to };
    this.#invalidate(from);
    this.#invalidate(to);
    this.#renaming.add(from);
    this.#renaming.add(to);
    session?.suspend();
    try {
      await renameNote(from, to);
    } catch (error) {
      session?.resume();
      this.#renaming.delete(from);
      this.#renaming.delete(to);
      throw error;
    }
    const outcome = this.rename(from, to);
    this.#renaming.delete(from);
    this.#renaming.delete(to);
    return outcome;
  }

  rename(from: string, to: string): RenameResult {
    this.#invalidate(from);
    this.#invalidate(to);
    if (from === to) return { kind: "already-renamed", from, to };
    const pendingAlias = this.#pendingDeletionOwners.get(from);
    const session =
      this.#sessions.get(from) ??
      (pendingAlias?.snapshot().lifecycle === "open" ? pendingAlias : undefined);
    const target = this.#sessions.get(to);
    if (!session) {
      return target ? { kind: "already-renamed", from, to } : { kind: "missing", from, to };
    }
    if (session.id === to && target === session) {
      return { kind: "already-renamed", from, to };
    }
    if (target && target !== session) {
      session.resume();
      return { kind: "collision", from, to };
    }
    session.rename(to);
    if (this.#sessions.get(from) === session) this.#sessions.delete(from);
    this.#sessions.set(to, session);
    if (session.isDeletionPending()) this.#rememberPendingOwner(from, session);
    return { kind: "renamed", from, to };
  }

  close(id: string): CloseResult {
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    if (!session) {
      this.#invalidate(id);
      return { kind: "missing" };
    }
    if (session.isDeletionPending()) return { kind: "active" };
    this.#invalidate(id);
    const dirty = session.dirty;
    if (!session.close()) return { kind: "active" };
    if (this.#sessions.get(session.id) === session) this.#sessions.delete(session.id);
    return { kind: "closed", dirty };
  }

  #identityVersion(id: string): number {
    return this.#identityVersions.get(id) ?? 0;
  }

  #deletionVersion(id: string): number {
    return this.#deletionVersions.get(id) ?? 0;
  }

  #pendingDeletionOwner(id: string): DocumentSession | undefined {
    const direct = this.#sessions.get(id);
    if (direct?.isDeletionPending()) return direct;
    const alias = this.#pendingDeletionOwners.get(id);
    return alias?.isDeletionPending() ? alias : undefined;
  }

  #rememberPendingOwner(alias: string, session: DocumentSession): void {
    this.#pendingDeletionOwners.set(alias, session);
    this.#pendingDeletionOwners.set(session.id, session);
  }

  #forgetPendingOwner(session: DocumentSession): void {
    for (const [alias, owner] of this.#pendingDeletionOwners) {
      if (owner === session) this.#pendingDeletionOwners.delete(alias);
    }
  }

  #invalidate(id: string): void {
    this.#identityVersions.set(id, this.#identityVersion(id) + 1);
  }
  #create(id: string, text: string, base: WriteBase): DocumentSession {
    const existing = this.#sessions.get(id);
    if (existing?.snapshot().lifecycle === "open") return existing;
    if (existing) this.#sessions.delete(id);
    const session = new DocumentSession(OWNER_TOKEN, id, text, base, this.#api, {
      emit: (event) => this.#emit(event),
      reportObserverFault: (fault) => this.#reportObserverFault(fault),
      draftSucceeded: () => {
        this.#blindDraft = false;
      },
      draftFailed: (doc) => {
        if (this.#blindDraft) return;
        this.#blindDraft = true;
        this.#emit({ kind: "draft-blind", id: doc });
      },
    });
    this.#sessions.set(id, session);
    return session;
  }

  #emit(event: DocumentSessionEvent): void | Promise<void> {
    const pending: Promise<void>[] = [];
    for (const listener of this.#listeners) {
      try {
        const result = listener(event);
        if (result) {
          pending.push(
            result.then(undefined, (error) => {
              this.#reportObserverFault({ kind: "listener", event, error });
            }),
          );
        }
      } catch (error) {
        this.#reportObserverFault({ kind: "listener", event, error });
      }
    }
    return pending.length === 0 ? undefined : Promise.all(pending).then(() => undefined);
  }

  #reportObserverFault(fault: DocumentSessionObserverFault): void {
    // Questo lavello non emette un evento di sessione: anche un listener
    // guasto durante la segnalazione non può richiamare ricorsivamente #emit.
    console.error("DocumentSession observer fault", fault);
  }

}

export const documentSessions = new DocumentSessionCollection();

export function flushPendingSave(): Promise<string[]> {
  return documentSessions.flushPendingSave();
}

export function flushBeforeClose(): Promise<void> {
  return documentSessions.flushBeforeClose();
}

export function renameKeepingBuffer(from: string, to: string): Promise<RenameResult> {
  return documentSessions.renameKeepingBuffer(from, to);
}
