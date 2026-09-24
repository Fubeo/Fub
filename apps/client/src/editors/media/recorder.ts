// Il registratore audio (P07/F24): consenso, lifecycle, recovery.
//
// Il microfono e' un permesso esplicito (`fub:microphone`, gia' nel catalogo):
// ogni avvio chiede `getUserMedia`, mai riuso silenzioso di uno stream; la
// revoca a meta' diventa stato `denied` con errore che lo dice, non silenzio.
// Il lifecycle e' una macchina chiusa (`idle → requesting → recording →
// stopped | denied | failed`): nessun salto non elencato, ogni transizione
// notificata a chi ascolta. La registrazione vive in `MediaRecorder` a chunk
// da 1s; ogni chunk si appende subito nel deposito crash-safe (stessa durevole
// proprieta' delle bozze §15.2) sotto chiave `media.recordings.<id>` nello
// stato di vista della macchina — mai `localStorage` della webview, che muore
// col profilo. Alla ripartenza, `recoverableRecordings` elenca cio' che non e'
// stato finalizzato; `finalizeRecording` lo chiude in un Blob inseribile.
// L'embed non lega la durata del file alla presenza del link: il file resta
// anche se il link si cancella.

import { depositAttachment, type AttachmentDeposit } from "./attachment-target";
export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "denied" | "failed";

export interface RecordingMeta {
  readonly id: string;
  readonly startedAt: number;
  readonly mime: string;
  readonly bytes: number;
  readonly finalized: boolean;
}

export interface CrashDeposit {
  append(key: string, chunk: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export type RecorderEvents = {
  onState(state: RecorderState, reason?: string): void;
  onLevel?(level: number): void;
};

const RECORDING_PREFIX = "media.recordings.";

function recordingKey(id: string): string {
  return `${RECORDING_PREFIX}${id}`;
}

function newRecordingId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `rec-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/** I tipi che questo browser sa registrare, in ordine di preferenza. */
export function preferredMimeTypes(): string[] {
  if (typeof MediaRecorder === "undefined") return [];
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.filter((mime) => {
    try {
      return MediaRecorder.isTypeSupported(mime);
    } catch {
      return false;
    }
  });
}

export interface AudioRecorder {
  readonly id: string;
  readonly state: RecorderState;
  start(): Promise<void>;
  stop(): Promise<RecordingMeta>;
  cancel(): Promise<void>;
  destroy(): void;
}

/**
 * Crea un registratore col deposito crash-safe iniettato. `getUserMedia` e
 * `MediaRecorder` restano dietro i globali di piattaforma (test: finti):
 * nessuna dipendenza da iniettare oltre il deposito.
 */
export function createAudioRecorder(deposit: CrashDeposit, events: RecorderEvents): AudioRecorder {
  const id = newRecordingId();
  const key = recordingKey(id);
  let state: RecorderState = "idle";
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let mime = "";
  let bytes = 0;
  let startedAt = 0;
  let pendingWrite: Promise<void> = Promise.resolve();
  let writeFailure: unknown = null;
  let stopped: Promise<void> = Promise.resolve();
  let destroyed = false;

  function set(next: RecorderState, reason?: string): void {
    state = next;
    events.onState(next, reason);
  }

  // Lo stato puo' cambiare nei callback del recorder durante gli await di stop.
  function recordingActive(): boolean {
    return state === "recording";
  }

  function releaseStream(): void {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      stream = null;
    }
  }

  return {
    get id() {
      return id;
    },
    get state() {
      return state;
    },
    async start(): Promise<void> {
      if (destroyed) throw new Error("recorder is destroyed");
      if (state !== "idle") throw new Error(`cannot start from ${state}`);
      set("requesting");
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        set("denied", error instanceof Error ? error.message : String(error));
        throw new Error(`microphone denied: ${error instanceof Error ? error.message : error}`);
      }
      if (destroyed) {
        for (const track of media.getTracks()) track.stop();
        set("idle");
        throw new Error("recorder is destroyed");
      }
      stream = media;
      const supported = preferredMimeTypes();
      if (supported.length === 0) {
        releaseStream();
        set("failed", "this browser cannot record audio");
        throw new Error("this browser cannot record audio");
      }
      startedAt = Date.now();
      let cause: unknown;
      for (const candidate of supported) {
        try {
          recorder = new MediaRecorder(stream, { mimeType: candidate });
          mime = candidate;
          break;
        } catch (error) {
          cause = error;
        }
      }
      if (!recorder) {
        releaseStream();
        set("failed", `no supported audio encoder started: ${String(cause)}`);
        throw new Error(`no supported audio encoder started: ${String(cause)}`);
      }
      stopped = new Promise<void>((resolve) => {
        recorder!.onstop = () => {
          releaseStream();
          resolve();
        };
      });
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size === 0) return;
        pendingWrite = pendingWrite.then(async () => {
          const chunk = new Uint8Array(await event.data.arrayBuffer());
          await deposit.append(key, chunk);
          bytes += chunk.byteLength;
        }).catch((error: unknown) => {
          writeFailure = error;
          if (!destroyed) set("failed", `recording could not be staged: ${String(error)}`);
          try {
            if (recorder?.state === "recording") recorder.stop();
          } catch {
            // The staged chunks remain recoverable; the failure is reported above.
          }
          releaseStream();
        });
      };
      recorder.onerror = () => {
        if (!destroyed) set("failed", "recording failed");
        releaseStream();
      };
      // La revoca a meta': le tracce finite portano a `failed` con ragione,
      // e cio' che si e' acquisito resta recuperabile nel deposito.
      for (const track of stream.getTracks()) {
        track.onended = () => {
          if (state === "recording" && !destroyed) {
            set("failed", "microphone was revoked");
            try {
              recorder?.stop();
            } catch {
              // lo stop su tracce finite e' best-effort
            }
          }
        };
      }
      try {
        recorder.start(1000);
      } catch (error) {
        releaseStream();
        set("failed", `recording could not start: ${String(error)}`);
        throw error;
      }
      set("recording");
    },
    async stop(): Promise<RecordingMeta> {
      if (!recordingActive() || !recorder) throw new Error(`cannot stop from ${state}`);
      recorder.stop();
      await stopped;
      await pendingWrite;
      releaseStream();
      if (writeFailure) throw new Error(`recording could not be staged: ${String(writeFailure)}`);
      if (destroyed || !recordingActive()) throw new Error("recording stopped because microphone access or staging failed");
      set("stopped");
      return { id, startedAt, mime, bytes, finalized: false };
    },
    async cancel(): Promise<void> {
      try { recorder?.stop(); } catch { /* already stopped */ }
      await stopped;
      releaseStream();
      await pendingWrite;
      await deposit.remove(key);
      if (!destroyed) set("idle");
    },
    destroy(): void {
      destroyed = true;
      try {
        recorder?.stop();
      } catch {
        // best-effort
      }
      releaseStream();
    },
  };
}

/** Le registrazioni non finalizzate nel deposito: recuperabili dopo un crash. */
export async function recoverableRecordings(deposit: CrashDeposit): Promise<RecordingMeta[]> {
  const keys = await deposit.list(RECORDING_PREFIX);
  const out: RecordingMeta[] = [];
  for (const key of keys) {
    const bytes = await deposit.read(key);
    if (!bytes || bytes.byteLength === 0) continue;
    out.push({
      id: key.slice(RECORDING_PREFIX.length),
      startedAt: 0,
      mime: sniffRecordingMime(bytes) ?? "application/octet-stream",
      bytes: bytes.byteLength,
      finalized: false,
    });
  }
  return out;
}

/** Legge la registrazione senza rimuoverla: solo il commit nel vault la consuma. */
export async function finalizeRecording(
  deposit: CrashDeposit,
  id: string,
): Promise<{ blob: Blob; meta: RecordingMeta }> {
  const bytes = await deposit.read(recordingKey(id));
  if (!bytes || bytes.byteLength === 0) {
    throw new Error(`recording ${id} has no recoverable audio`);
  }
  const mime = sniffRecordingMime(bytes);
  if (!mime) throw new Error(`recording ${id} has an unrecognized audio container`);
  const blob = new Blob([bytes as BlobPart], { type: mime });
  return { blob, meta: { id, startedAt: 0, mime, bytes: bytes.byteLength, finalized: false } };
}


/** Commit first, then discard the staged audio; failure leaves it recoverable. */
export async function commitRecording(
  staging: CrashDeposit,
  id: string,
  deposit: AttachmentDeposit,
): Promise<{ id: string; link: string }> {
  const { blob, meta } = await finalizeRecording(staging, id);
  const ext = meta.mime === "audio/mp4" ? "m4a" : meta.mime === "audio/ogg" ? "ogg" : "webm";
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { receipt, link } = await depositAttachment(deposit, `recording-${id}.${ext}`, bytes);
  await staging.remove(`media.recordings.${id}`);
  return { id: receipt.id, link };
}
function sniffRecordingMime(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "audio/webm";
  }
  if (bytes.byteLength >= 8 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp") {
    return "audio/mp4";
  }
  if (bytes.byteLength >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return "audio/ogg";
  }
  return null;
}
