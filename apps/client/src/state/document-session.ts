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
  type UnderChange,
} from "./saving";
import { rejoinDrafts, type DraftBuffer, type DraftBufferStore } from "./drafts";
import { renameNote } from "./vault";

const SAVE_MS = 400;
const DRAFT_MS = 1_000;

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
  readonly lifecycle: "open" | "closed";
}

export type DocumentSessionEvent =
  | { kind: "changed"; id: string }
  | { kind: "saved"; id: string }
  | { kind: "save-failed"; id: string; error: unknown; outcome: "conflitto" | "fallito" }
  | { kind: "draft-blind"; id: string };

type SessionListener = (event: DocumentSessionEvent) => void | Promise<void>;

type SessionHooks = {
  emit(event: DocumentSessionEvent): void | Promise<void>;
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
  lifecycle: "open" | "closed";
}

const OWNER_TOKEN = Symbol("DocumentSession owner");
type OwnerToken = typeof OWNER_TOKEN;

function copyBase(base: WriteBase): WriteBase {
  return base.kind === "dictated"
    ? { kind: "dictated" }
    : { kind: "descends_from", value: base.value };
}

/** The per-document owner. Its constructor is guarded by the collection token. */
export class DocumentSession implements DraftBuffer {
  #id: string;
  #state: SessionState;
  #queue = new Queue();
  #saveTimer: number | undefined;
  #draftTimer: number | undefined;
  readonly #api: DocumentSessionApi;
  readonly #hooks: SessionHooks;

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
      lifecycle: this.#state.lifecycle,
    };
  }

  consumeChange(source: Origin): UnderChange {
    return consumeUnderChange(this.#state, source);
  }

  /** The panel calls this only after validating the editor operation. */
  acceptEditorChange(text: string): void {
    if (!this.#isOpen()) return;
    this.#state.text = text;
    this.#state.dirty = true;
    this.#emit({ kind: "changed", id: this.#id });
    this.scheduleSave();
    this.scheduleDraft();
  }

  restoreDraft(text: string, base: WriteBase): void {
    if (!this.#isOpen()) return;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#state.text = text;
    this.#state.base = copyBase(base);
    this.#state.dirty = true;
    this.#state.result = "ok";
    this.#state.echoes = 0;
    this.#emit({ kind: "changed", id: this.#id });
  }

  /** Reread a clean session and return whether its visible text changed. */
  reloadIfClean(text: string, revision: string): boolean {
    if (!this.#isOpen() || this.#state.dirty) return false;
    const changed = this.#state.text !== text;
    this.#state.base = { kind: "descends_from", value: revision };
    if (changed) {
      this.#state.text = text;
      this.#emit({ kind: "changed", id: this.#id });
    }
    return changed;
  }

  /** Used by an explicit reload after a version restore. */
  markClean(): void {
    if (!this.#isOpen()) return;
    this.#state.dirty = false;
    this.#emit({ kind: "changed", id: this.#id });
  }

  discardChanges(): void {
    if (!this.#isOpen()) return;
    this.#clearSaveTimer();
    this.#state.dirty = false;
    this.#state.result = "ok";
    this.#emit({ kind: "changed", id: this.#id });
  }

  scheduleSave(): void {
    if (!this.#isOpen() || this.#state.suspended) return;
    if (this.#state.result === "conflitto") return;
    this.#clearSaveTimer();
    const id = this.#id;
    this.#saveTimer = window.setTimeout(() => {
      this.#saveTimer = undefined;
      void this.#saveNow(id);
    }, SAVE_MS);
  }

  scheduleDraft(): void {
    if (!this.#isOpen() || this.#state.suspended) return;
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

  suspend(): boolean {
    if (!this.#isOpen()) return false;
    this.#state.suspended = true;
    const dirty = this.#state.dirty;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    return dirty;
  }

  resume(): void {
    if (!this.#isOpen() || !this.#state.suspended) return;
    this.#state.suspended = false;
    if (!this.#state.dirty) return;
    this.scheduleSave();
    this.scheduleDraft();
  }

  async discardDraft(): Promise<void> {
    if (!this.#isOpen()) return;
    this.#state.suspended = false;
    this.#clearDraftTimer();
    await this.#dropDraft(this.#id);
  }

  async saveKeepingMine(): Promise<void> {
    if (!this.#isOpen() || this.#state.result !== "conflitto") return;
    this.#clearSaveTimer();
    this.#state.base = { kind: "dictated" };
    this.#state.result = "in_corso";
    this.#emit({ kind: "changed", id: this.#id });
    await this.#saveNow(this.#id);
  }

  rename(id: string): void {
    if (!this.#isOpen() || id === this.#id) return;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#id = id;
    this.#state.suspended = false;
    if (this.#state.dirty) {
      this.scheduleSave();
      this.scheduleDraft();
    }
  }

  close(): void {
    if (!this.#isOpen()) return;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#state.suspended = false;
    this.#state.lifecycle = "closed";
  }

  #isOpen(): boolean {
    return this.#state.lifecycle === "open";
  }

  #emit(event: DocumentSessionEvent): void {
    this.#hooks.emit(event);
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
    if (!this.#isOpen()) return Promise.resolve();
    return this.#queue.enqueue(() => this.#writeBuffer(id));
  }

  async #writeBuffer(id: string): Promise<void> {
    if (!this.#isOpen() || this.#id !== id || !this.#state.dirty) return;
    const text = this.#state.text;
    const base = copyBase(this.#state.base);
    this.#state.result = "in_corso";
    this.#emit({ kind: "changed", id });

    let produced: string;
    try {
      produced = await writeCountingEcho(this.#state, () => this.#api.writeDocument(id, text, base));
    } catch (error) {
      if (!this.#isOpen()) return;
      const outcome = failureOutcome(error);
      this.#state.result = outcome;
      this.#clearDraftTimer();
      void this.#writeDraft(this.#id);
      this.#emit({ kind: "save-failed", id: this.#id, error, outcome });
      return;
    }

    if (!this.#isOpen()) return;
    this.#state.result = "ok";
    this.#state.base = { kind: "descends_from", value: produced };
    if (this.#state.text === text) {
      this.#state.dirty = false;
      void this.#dropDraft(this.#id);
    }
    await this.#emit({ kind: "saved", id: this.#id });
  }

  #writeDraft(id: string): Promise<void> {
    if (!this.#isOpen() || this.#id !== id || !this.#state.dirty) return Promise.resolve();
    return this.#queue.enqueue(async () => {
      if (!this.#isOpen() || this.#id !== id || !this.#state.dirty) return;
      try {
        await this.#api.saveDraft(
          id,
          this.#state.text,
          this.#state.base.kind === "descends_from" ? this.#state.base.value : null,
        );
        this.#hooks.draftSucceeded();
      } catch {
        this.#hooks.draftFailed(id);
      }
    });
  }

  #dropDraft(id: string): Promise<void> {
    if (this.#id !== id) return Promise.resolve();
    return this.#queue.enqueue(async () => {
      if (this.#id !== id) return;
      try {
        await this.#api.discardDraft(id);
      } catch {
        // A draft is a safety net; its cleanup is deliberately best effort.
      }
    });
  }
}

/** The sole collection and construction path for document sessions. */
export class DocumentSessionCollection implements DraftBufferStore {
  readonly #api: DocumentSessionApi;
  readonly #sessions = new Map<string, DocumentSession>();
  readonly #listeners = new Set<SessionListener>();
  #blindDraft = false;

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

  saveState(id: string): SaveState | null {
    return this.#sessions.get(id)?.saveState() ?? null;
  }

  consumeChange(id: string, source: Origin): UnderChange {
    return this.#sessions.get(id)?.consumeChange(source) ?? "muto";
  }

  async read(id: string): Promise<string> {
    const existing = this.#sessions.get(id);
    if (existing) return existing.text();
    const source = await this.#api.readDocument(id);
    const current = this.#sessions.get(id);
    if (current) return current.text();
    return this.#create(id, source.text, { kind: "descends_from", value: source.revision }).text();
  }

  acceptEditorChange(id: string, text: string): void {
    const session = this.#sessions.get(id) ?? this.#create(id, text, { kind: "dictated" });
    session.acceptEditorChange(text);
  }

  async reloadIfClean(id: string): Promise<{ text: string; changed: boolean } | null> {
    const session = this.#sessions.get(id);
    if (session?.dirty) return null;
    let source: { text: string; revision: string };
    try {
      source = await this.#api.readDocument(id);
    } catch {
      return null;
    }
    const current = this.#sessions.get(id);
    if (!session || current !== session || session.dirty) return null;
    const changed = session.reloadIfClean(source.text, source.revision);
    return { text: session.text(), changed };
  }

  markClean(id: string): void {
    this.#sessions.get(id)?.markClean();
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

  suspendSave(id: string): boolean {
    return this.#sessions.get(id)?.suspend() ?? false;
  }

  resumeSave(id: string): void {
    this.#sessions.get(id)?.resume();
  }

  async renameKeepingBuffer(from: string, to: string): Promise<void> {
    this.#sessions.get(from)?.suspend();
    try {
      await renameNote(from, to);
    } catch (error) {
      this.#sessions.get(from)?.resume();
      throw error;
    }
  }

  rename(from: string, to: string): void {
    if (from === to) return;
    const session = this.#sessions.get(from);
    if (!session) return;
    this.#sessions.delete(from);
    const previous = this.#sessions.get(to);
    previous?.close();
    session.rename(to);
    this.#sessions.set(to, session);
  }

  async discardDraft(id: string): Promise<void> {
    const session = this.#sessions.get(id);
    if (session) {
      await session.discardDraft();
      return;
    }
    try {
      await this.#api.discardDraft(id);
    } catch {
      // Keep the same best-effort behavior when there is no local session.
    }
  }

  async saveConflictMine(id: string): Promise<void> {
    await this.#sessions.get(id)?.saveKeepingMine();
  }

  async discardChanges(id: string): Promise<void> {
    const session = this.#sessions.get(id);
    if (!session) return;
    session.discardChanges();
    await session.discardDraft();
  }

  close(id: string): void {
    const session = this.#sessions.get(id);
    if (!session) return;
    session.close();
    this.#sessions.delete(id);
  }

  #create(id: string, text: string, base: WriteBase): DocumentSession {
    const existing = this.#sessions.get(id);
    if (existing) return existing;
    const session = new DocumentSession(OWNER_TOKEN, id, text, base, this.#api, {
      emit: (event) => this.#emit(event),
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
      const result = listener(event);
      if (result) pending.push(result);
    }
    return pending.length === 0 ? undefined : Promise.all(pending).then(() => undefined);
  }

}

export const documentSessions = new DocumentSessionCollection();

export function flushPendingSave(): Promise<string[]> {
  return documentSessions.flushPendingSave();
}

export function flushBeforeClose(): Promise<void> {
  return documentSessions.flushBeforeClose();
}

export function suspendSave(id: string): boolean {
  return documentSessions.suspendSave(id);
}

export function resumeSave(id: string): void {
  documentSessions.resumeSave(id);
}

export function renameKeepingBuffer(from: string, to: string): Promise<void> {
  return documentSessions.renameKeepingBuffer(from, to);
}

export function discardDraft(id: string): Promise<void> {
  return documentSessions.discardDraft(id);
}
