import type { DocumentWindowRequest } from "../host/contract";
export type { DocumentWindowRequest } from "../host/contract";
import { operationFromText, tryApplyOperation, validateOperation, type TextOperation, type TextEdit } from "../editor/text-operation";
import { documentSessions, type DocumentSession } from "./document-session";
import { state } from "./store";

const normalized = (text: string): string => text.replace(/\r\n?/g, "\n");
const lineSeparator = (text: string): "\n" | "\r\n" =>
  text.includes("\r\n") && !/(^|[^\r])\n/.test(text) ? "\r\n" : "\n";

type Identity = { v: 1; doc: string; vault: string; session: string; surfaceId: string };
type ConflictReason = "epoch-changed" | "session-unavailable" | "history-unavailable"
  | "overlap" | "preimage" | "realigned" | "untracked" | "revision-gap";
const conflictReasons: Record<ConflictReason, true> = {
  "epoch-changed": true, "session-unavailable": true, "history-unavailable": true,
  overlap: true, preimage: true, realigned: true, untracked: true, "revision-gap": true,
};
export type RemoteMessage = Identity & (
  | { kind: "hello" }
  | { kind: "snapshot"; text: string; epoch: string; revision: number; appliedSeq: number; diskRevision: string }
  | { kind: "snapshot-error"; reason: string }
  | { kind: "operation"; epoch: string; seq: number; base: number; revision: number; operation: TextOperation }
  | { kind: "ack"; epoch: string; seq: number; base: number; revision: number; operation: TextOperation }
  | { kind: "conflict"; epoch: string; seq: number; revision: number; reason: ConflictReason }
  | { kind: "resync"; text: string; epoch: string; revision: number; reason: "reload" }
  | { kind: "freeze"; epoch: string; token: string }
  | { kind: "thaw"; epoch: string; token: string }
  | { kind: "drain-ready"; epoch: string; token: string; seq: number; revision: number }
);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function counter(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
export function isRemoteMessage(value: unknown): value is RemoteMessage {
  const m = record(value);
  if (!m || m.v !== 1 || typeof m.doc !== "string" || !m.doc || typeof m.vault !== "string" || !m.vault
    || typeof m.session !== "string" || !m.session || typeof m.surfaceId !== "string" || !m.surfaceId) return false;
  switch (m.kind) {
    case "hello": return true;
    case "snapshot": return typeof m.text === "string" && typeof m.epoch === "string" && !!m.epoch
      && counter(m.revision) && counter(m.appliedSeq) && typeof m.diskRevision === "string";
    case "snapshot-error": return typeof m.reason === "string";
    case "operation":
    case "ack": return typeof m.epoch === "string" && !!m.epoch && counter(m.seq) && counter(m.base)
      && counter(m.revision) && m.revision === m.base + 1 && validateOperation(m.operation as TextOperation) === null;
    case "conflict": return typeof m.epoch === "string" && !!m.epoch && counter(m.seq) && counter(m.revision)
      && typeof m.reason === "string" && Object.prototype.hasOwnProperty.call(conflictReasons, m.reason);
    case "resync": return typeof m.epoch === "string" && !!m.epoch && typeof m.text === "string"
      && counter(m.revision) && m.reason === "reload";
    case "freeze":
    case "thaw": return typeof m.epoch === "string" && !!m.epoch && typeof m.token === "string" && !!m.token;
    case "drain-ready": return typeof m.epoch === "string" && !!m.epoch && typeof m.token === "string"
      && !!m.token && counter(m.seq) && counter(m.revision);
    default: return false;
  }
}

/** Transform disjoint edits on a shared preimage. An overlap is a recoverable conflict. */
function transformPair(local: TextOperation, remote: TextOperation): [TextOperation, TextOperation] | null {
  if (local.beforeLength !== remote.beforeLength) return null;
  const shift = (edit: TextEdit, other: readonly TextEdit[]): TextEdit | null => {
    let delta = 0;
    for (const change of other) {
      // Adjacent edits are independent; coincident insertions have no stable order.
      if (change.from === change.to && edit.from === edit.to && change.from === edit.from) return null;
      if (change.to <= edit.from && !(change.from === change.to && change.from === edit.from)) {
        delta += change.inserted.length - change.deleted.length;
      } else if (change.from >= edit.to && !(edit.from === edit.to && change.from === edit.from)) {
        continue;
      } else {
        return null;
      }
    }
    return { ...edit, from: edit.from + delta, to: edit.to + delta };
  };
  const shiftAll = (source: TextOperation, other: TextOperation): TextOperation | null => {
    const edits: TextEdit[] = [];
    for (const edit of source.edits) {
      const mapped = shift(edit, other.edits);
      if (!mapped) return null;
      edits.push(mapped);
    }
    return { beforeLength: other.afterLength, afterLength: other.afterLength + source.afterLength - source.beforeLength, edits };
  };
  const left = shiftAll(local, remote);
  const right = shiftAll(remote, local);
  return left && right && !validateOperation(left) && !validateOperation(right) ? [left, right] : null;
}

interface Step { base: number; operation: TextOperation }
interface Authority {
  owner: DocumentSession;
  session: string;
  epoch: string;
  revision: number;
  steps: Step[];
  endpoints: Set<Endpoint>;
  applyingSurface: string | null;
  detach: () => void;
}
interface Endpoint {
  request: DocumentWindowRequest;
  port: BroadcastChannel;
  active: boolean;
  ready: boolean;
  lastSeq: number;
  lastReply: RemoteMessage | null;
  frozenToken: string | null;
  drain: { token: string; resolve: () => void; reject: (reason: Error) => void; timer: number } | null;
}
const authorities = new Map<string, Authority>();
const keyOf = (vault: string, doc: string): string => `${vault}\0${doc}`;
const identity = (request: DocumentWindowRequest): Identity => ({
  v: 1, doc: request.document, vault: request.vault, session: request.session, surfaceId: request.surfaceId,
});
const unique = (): string => crypto.randomUUID();

export interface RemoteSurfaceHandle {
  channel: string;
  surfaceId: string;
  freeze(): Promise<void>;
  thaw(): void;
  dispose(): Promise<void>;
}

export async function attachRemoteSurface(doc: string, vault: string): Promise<{ request: DocumentWindowRequest; handle: RemoteSurfaceHandle }> {
  if (!doc || !vault || state.vaultRoot !== vault) throw new Error("Vault documento non disponibile");
  let releaseLease = documentSessions.retain(doc);
  let authority: Authority;
  try {
    await documentSessions.readForSurface(doc);
    const owner = documentSessions.get(doc);
    if (state.vaultRoot !== vault || !owner || owner.snapshot().lifecycle !== "open") throw new Error("Sessione documento cambiata");
    const key = keyOf(vault, doc);
    const old = authorities.get(key);
    if (old && old.owner === owner) {
      authority = old;
    } else {
      if (old?.endpoints.size) throw new Error("La sessione precedente ha ancora finestre aperte");
      const created: Authority = { owner, session: unique(), epoch: unique(), revision: 0, steps: [], endpoints: new Set(), applyingSurface: null, detach: () => {} };
      created.detach = documentSessions.attachSurface(doc, {
        id: `bridge:${created.session}`,
        sync: (update) => {
          if (authorities.get(key) !== created || state.vaultRoot !== vault || documentSessions.get(doc) !== owner) return;
          if (update.kind === "operation") {
            const base = created.revision++;
            created.steps.push({ base, operation: update.operation });
            if (created.steps.length > 256) created.steps.shift();
            for (const endpoint of created.endpoints) {
              if (endpoint.active && endpoint.ready && endpoint.request.surfaceId !== created.applyingSurface) {
                endpoint.port.postMessage({ ...identity(endpoint.request), kind: "operation", epoch: created.epoch,
                  seq: 0, base, revision: created.revision, operation: update.operation } satisfies RemoteMessage);
              }
            }
          } else {
            created.epoch = unique();
            created.revision = 0;
            created.steps.length = 0;
            for (const endpoint of created.endpoints) if (endpoint.active && endpoint.ready) {
              endpoint.port.postMessage({ ...identity(endpoint.request), kind: "resync", epoch: created.epoch,
                text: update.text, revision: created.revision, reason: "reload" } satisfies RemoteMessage);
            }
          }
        },
      });
      authorities.set(key, created);
      authority = created;
    }
    const request: DocumentWindowRequest = {
      surface: "document", channel: `docwin-${unique()}`, document: doc, vault,
      session: authority.session, surfaceId: `remote:${unique()}`,
    };
    const port = new BroadcastChannel(request.channel);
    const endpoint: Endpoint = { request, port, active: true, ready: false, lastSeq: 0, lastReply: null, frozenToken: null, drain: null };
    authority.endpoints.add(endpoint);
    const scoped = (): boolean => endpoint.active && state.vaultRoot === vault && documentSessions.get(doc) === owner
      && authorities.get(keyOf(vault, doc)) === authority;
    const reply = (message: RemoteMessage): void => { if (endpoint.active) port.postMessage(message); };
    port.onmessage = (event: MessageEvent<unknown>) => {
      if (!endpoint.active || !isRemoteMessage(event.data)) return;
      const message = event.data;
      if (message.doc !== doc || message.vault !== vault || message.session !== request.session || message.surfaceId !== request.surfaceId) return;
      if (!scoped()) {
        if (message.kind === "hello") {
          reply({ ...identity(request), kind: "snapshot-error", reason: "Sessione documento o vault non più disponibile" });
        } else if (message.kind === "operation") {
          reply({ ...identity(request), kind: "conflict", epoch: authority.epoch, seq: message.seq,
            revision: authority.revision, reason: "session-unavailable" });
        }
        return;
      }
      if (message.kind === "hello") {
        endpoint.ready = true;
        const snapshot = owner.snapshot();
        reply({ ...identity(request), kind: "snapshot", text: snapshot.text, epoch: authority.epoch,
          revision: authority.revision, appliedSeq: endpoint.lastSeq,
          diskRevision: snapshot.base.kind === "descends_from" ? snapshot.base.value : "" });
        return;
      }
      if (!endpoint.ready) return;
      if (message.kind === "operation") {
        if (message.epoch !== authority.epoch) {
          reply({ ...identity(request), kind: "conflict", epoch: authority.epoch, seq: message.seq,
            revision: authority.revision, reason: "epoch-changed" });
          return;
        }
        if (message.seq === 0) return;
        if (message.seq === endpoint.lastSeq && endpoint.lastReply) { reply(endpoint.lastReply); return; }
        if (message.seq !== endpoint.lastSeq + 1) return;
        const now = authority.revision;
        let operation = message.operation;
        if (message.base > now || message.base < (authority.steps[0]?.base ?? now)) {
          reply({ ...identity(request), kind: "conflict", epoch: authority.epoch, seq: message.seq, revision: now, reason: "history-unavailable" });
          return;
        }
        for (const step of authority.steps) if (step.base >= message.base) {
          const pair = transformPair(operation, step.operation);
          if (!pair) {
            reply({ ...identity(request), kind: "conflict", epoch: authority.epoch, seq: message.seq, revision: authority.revision, reason: "overlap" });
            return;
          }
          operation = pair[0];
        }
        const before = owner.text();
        const applied = tryApplyOperation(normalized(before), operation);
        if (applied.kind !== "applied") {
          reply({ ...identity(request), kind: "conflict", epoch: authority.epoch, seq: message.seq, revision: authority.revision, reason: "preimage" });
          return;
        }
        const base = authority.revision;
        authority.applyingSurface = request.surfaceId;
        let result;
        try {
          const separator = lineSeparator(before);
          const updated = separator === "\r\n" ? applied.text.replace(/\n/g, separator) : applied.text;
          result = documentSessions.acceptSurfaceChange(doc, request.surfaceId, { text: updated, operation });
        } finally {
          authority.applyingSurface = null;
        }
        if (result.kind !== "accepted" || authority.revision !== base + 1) {
          reply({ ...identity(request), kind: "conflict", epoch: authority.epoch, seq: message.seq,
            revision: authority.revision, reason: result.kind === "accepted" ? "revision-gap" : result.kind });
          return;
        }
        endpoint.lastSeq = message.seq;
        endpoint.lastReply = { ...identity(request), kind: "ack", epoch: authority.epoch,
          seq: message.seq, base, revision: authority.revision, operation };
        reply(endpoint.lastReply);
        return;
      }
      if (message.kind === "drain-ready" && endpoint.drain && message.token === endpoint.drain.token
        && message.epoch === authority.epoch && message.seq === endpoint.lastSeq && message.revision === authority.revision) {
        const pending = endpoint.drain;
        endpoint.drain = null;
        clearTimeout(pending.timer);
        pending.resolve();
      }
    };
    let disposed = false;
    let disposing: Promise<void> | null = null;
    return { request, handle: {
      channel: request.channel, surfaceId: request.surfaceId,
      freeze: () => {
        if (!scoped() || !endpoint.ready) return Promise.reject(new Error("Finestra non connessa alla sessione"));
        if (endpoint.drain) return Promise.reject(new Error("Drain già in corso"));
        const token = unique();
        return new Promise<void>((resolve, reject) => {
          const timer = globalThis.setTimeout(() => {
            endpoint.drain = null;
            reject(new Error("Timeout acknowledgement della finestra: sessione mantenuta"));
          }, 5000);
          endpoint.drain = { token, resolve, reject, timer };
          endpoint.frozenToken = token;
          reply({ ...identity(request), kind: "freeze", epoch: authority.epoch, token });
        });
      },
      thaw: () => {
        if (endpoint.active && endpoint.frozenToken) {
          reply({ ...identity(request), kind: "thaw", epoch: authority.epoch, token: endpoint.frozenToken });
          endpoint.frozenToken = null;
        }
      },
      dispose: () => {
        if (disposed) return Promise.resolve();
        if (disposing) return disposing;
        if (endpoint.drain) return Promise.reject(new Error("Drain in corso: impossibile rilasciare la sessione"));
        disposing = (async () => {
          releaseLease();
          try {
            await documentSessions.release(doc);
          } catch (error) {
            releaseLease = documentSessions.retain(doc);
            throw error;
          }
          disposed = true;
          endpoint.active = false;
          port.onmessage = null;
          port.close();
          authority.endpoints.delete(endpoint);
          if (authority.endpoints.size === 0) {
            authority.detach();
            if (authorities.get(keyOf(vault, doc)) === authority) authorities.delete(keyOf(vault, doc));
          }
        })();
        return disposing.finally(() => { disposing = null; });
      },
    } };
  } catch (error) {
    releaseLease();
    throw error;
  }
}

export interface ChildBridge {
  sendEdit(text: string, operation: TextOperation): void;
  resolveConflict(choice: "mine" | "theirs"): void;
  dispose(): boolean;
}

export function attachChildBridge(
  request: DocumentWindowRequest,
  apply: (text: string, operation: TextOperation | null) => void,
  current: () => string,
  onState: (state: { kind: "ready" | "frozen" | "error"; reason?: string }) => void,
): ChildBridge {
  const port = new BroadcastChannel(request.channel);
  const id = identity(request);
  let alive = true;
  let initialized = false;
  let frozen = false;
  let failed = false;
  let authoritative = "";
  let separator: "\n" | "\r\n" = "\n";
  let epoch = "";
  let revision = 0;
  let nextSeq = 0;
  let outstanding = false;
  const pending: { seq: number; operation: TextOperation }[] = [];
  let freezeToken: string | null = null;
  let frozenToken: string | null = null;
  let recovery: string | null = null;
  const sendNext = (): void => {
    if (!initialized || outstanding || failed || !pending.length || !alive) return;
    outstanding = true;
    port.postMessage({ ...id, kind: "operation", epoch, seq: pending[0].seq, base: revision,
      revision: revision + 1, operation: pending[0].operation } satisfies RemoteMessage);
  };
  const report = (reason: string): void => { failed = true; onState({ kind: "error", reason }); };
  const finishFreeze = (): void => {
    if (!freezeToken || outstanding || pending.length || failed) return;
    port.postMessage({ ...id, kind: "drain-ready", epoch, token: freezeToken, seq: nextSeq, revision } satisfies RemoteMessage);
    freezeToken = null;
  };
  port.onmessage = (event: MessageEvent<unknown>) => {
    if (!alive || !isRemoteMessage(event.data)) return;
    const message = event.data;
    if (message.doc !== id.doc || message.vault !== id.vault || message.session !== id.session || message.surfaceId !== id.surfaceId) return;
    if (message.kind === "snapshot-error") { report(message.reason); return; }
    if (message.kind === "snapshot") {
      if (initialized || pending.length) return;
      initialized = true;
      separator = lineSeparator(message.text);
      authoritative = normalized(message.text);
      epoch = message.epoch;
      revision = message.revision;
      nextSeq = message.appliedSeq;
      if (recovery !== null) {
        const kept = recovery;
        recovery = null;
        if (normalized(kept) !== authoritative) {
          pending.push({ seq: ++nextSeq, operation: operationFromText(authoritative, normalized(kept)) });
        }
      } else {
        apply(message.text, null); // Bootstrap or explicit discard, never an untracked edit.
      }
      onState({ kind: "ready" });
      sendNext();
      return;
    }
    if (message.kind === "thaw") {
      if (frozen && frozenToken === message.token) {
        frozen = false;
        frozenToken = null;
        freezeToken = null;
        if (!failed) onState({ kind: "ready" });
      }
      return;
    }
    if (!initialized || failed) return;
    if (message.kind === "hello" || message.kind === "drain-ready") return;
    if (message.kind !== "resync" && message.epoch !== epoch) return;
    if (message.kind === "freeze") {
      frozenToken = message.token;
      frozen = true;
      freezeToken = message.token;
      onState({ kind: "frozen" }); // Host disables input before the acknowledgement.
      finishFreeze();
      return;
    }
    if (message.kind === "conflict") {
      if (pending[0]?.seq === message.seq) report(`Conflitto ${message.reason}: modifiche locali ancora nella finestra`);
      return;
    }
    if (message.kind === "resync") {
      if (message.epoch === epoch && message.revision <= revision) return;
      if (pending.length) { report("Sorgente sostituita: modifiche locali ancora nella finestra"); return; }
      epoch = message.epoch;
      revision = message.revision;
      separator = lineSeparator(message.text);
      authoritative = normalized(message.text);
      apply(message.text, null);
      return;
    }
    if (message.kind === "operation") {
      if (message.revision <= revision) return;
      if (message.base !== revision) { report("Sequenza remota interrotta: documento locale conservato"); return; }
      const changed = tryApplyOperation(authoritative, message.operation);
      if (changed.kind !== "applied") { report("Operazione remota malformata: documento locale conservato"); return; }
      let remote = message.operation;
      const rebased: TextOperation[] = [];
      for (const intent of pending) {
        const pair = transformPair(intent.operation, remote);
        if (!pair) { report("Modifiche concorrenti sovrapposte: documento locale conservato"); return; }
        rebased.push(pair[0]);
        remote = pair[1];
      }
      const next = tryApplyOperation(normalized(current()), remote);
      if (next.kind !== "applied") { report("Impossibile riallineare le modifiche locali"); return; }
      authoritative = changed.text;
      revision = message.revision;
      pending.forEach((intent, index) => { intent.operation = rebased[index]; });
      apply(separator === "\r\n" ? next.text.replace(/\n/g, separator) : next.text, remote);
      sendNext();
      finishFreeze();
      return;
    }
    if (message.kind === "ack") {
      if (!outstanding || pending[0]?.seq !== message.seq) return;
      if (message.revision <= revision) { report("Acknowledgement obsoleto: modifiche locali conservate"); return; }
      if (message.base !== revision) { report("Acknowledgement fuori sequenza: modifiche locali conservate"); return; }
      const changed = tryApplyOperation(authoritative, message.operation);
      if (changed.kind !== "applied") { report("Acknowledgement non valido: modifiche locali conservate"); return; }
      const intent = pending[0];
      const expected = tryApplyOperation(authoritative, intent.operation);
      if (expected.kind !== "applied" || expected.text !== changed.text) {
        report("Riallineamento non verificato: modifiche locali conservate"); return;
      }
      pending.shift();
      outstanding = false;
      authoritative = changed.text;
      revision = message.revision;
      sendNext();
      finishFreeze();
    }
  };
  port.postMessage({ ...id, kind: "hello" } satisfies RemoteMessage);
  return {
    sendEdit: (text, operation) => {
      if (!alive || frozen || failed || !initialized) throw new Error("Finestra non pronta alla modifica");
      const previous = pending.reduce<string | null>((value, intent) => {
        if (value === null) return null;
        const next = tryApplyOperation(value, intent.operation);
        return next.kind === "applied" ? next.text : null;
      }, authoritative);
      const changed = previous === null ? null : tryApplyOperation(previous, operation);
      if (!changed || changed.kind !== "applied" || changed.text !== normalized(text)) {
        report("Modifica locale non valida: testo conservato nella finestra");
        throw new Error("Operazione locale incoerente");
      }
      pending.push({ seq: ++nextSeq, operation });
      sendNext();
    },
    resolveConflict: (choice) => {
      if (!alive || !failed || frozen) throw new Error("Conflitto non recuperabile durante il drain");
      recovery = choice === "mine" ? current() : null;
      pending.length = 0;
      outstanding = false;
      failed = false;
      initialized = false;
      port.postMessage({ ...id, kind: "hello" } satisfies RemoteMessage);
    },
    dispose: () => {
      if (!alive) return true;
      if (pending.length || outstanding) return false;
      alive = false;
      port.onmessage = null;
      port.close();
      return true;
    },
  };
}
