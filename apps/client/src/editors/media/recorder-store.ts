import type { CrashDeposit } from "./recorder";

/** Existing machine view-state port, injected by composition (never webview localStorage). */
export interface RecordingStatePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const INDEX = "media.recordings.index";
const PREFIX = "media.recordings.";
const LIMIT = 64 * 1024 * 1024;
type Index = { schema: 1; keys: string[] };
type RecordValue = { schema: 1; chunks: string[] };

function validKey(key: string): boolean {
  return key.startsWith(PREFIX) && key !== INDEX && /^[A-Za-z0-9-]{1,100}$/.test(key.slice(PREFIX.length));
}

function decode(value: unknown): RecordValue | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || !("schema" in value) || value.schema !== 1 ||
      !("chunks" in value) || !Array.isArray(value.chunks) || !value.chunks.every((part) => typeof part === "string")) {
    throw new Error("unknown or corrupt recording state schema; preserving its bytes");
  }
  return value as RecordValue;
}

function decodeIndex(value: unknown): Index {
  if (value === null) return { schema: 1, keys: [] };
  if (!value || typeof value !== "object" || !("schema" in value) || value.schema !== 1 ||
      !("keys" in value) || !Array.isArray(value.keys) || !value.keys.every(validKey)) {
    throw new Error("unknown or corrupt recording index schema; preserving its bytes");
  }
  if (new Set(value.keys).size !== value.keys.length) {
    throw new Error("duplicate recording keys; preserving the index");
  }
  return value as Index;
}

function encode(bytes: Uint8Array): string {
  let text = "";
  for (let n = 0; n < bytes.length; n += 8192) {
    text += String.fromCharCode(...bytes.subarray(n, n + 8192));
  }
  return btoa(text);
}

/**
 * Stages every recorder chunk through the machine's fsynced view-state port.
 * Index is committed before data so a crash never leaves an undiscoverable
 * recording. The schema is explicit; unknown future values are never rewritten.
 */
export function createViewStateCrashDeposit(port: RecordingStatePort): CrashDeposit {
  let queue: Promise<void> = Promise.resolve();
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    queue = result.then(() => {}, () => {});
    return result;
  }
  return {
    append(key, chunk) {
      return serialized(async () => {
        if (!validKey(key)) throw new Error("invalid recording key");
        const index = decodeIndex(await port.get(INDEX));
        const record = decode(await port.get(key)) ?? { schema: 1 as const, chunks: [] };
        const previous = record.chunks.reduce((sum, part) => sum + Math.floor(part.length * 3 / 4), 0);
        if (previous + chunk.byteLength > LIMIT) throw new Error(`recording exceeds ${LIMIT}-byte staging limit`);
        if (!index.keys.includes(key)) await port.set(INDEX, { schema: 1, keys: [...index.keys, key] });
        await port.set(key, { schema: 1, chunks: [...record.chunks, encode(chunk)] });
      });
    },
    read(key) {
      return serialized(async () => {
        if (!validKey(key)) throw new Error("invalid recording key");
        const record = decode(await port.get(key));
        if (!record) return null;
        const upperBound = record.chunks.reduce((sum, part) => sum + Math.floor(part.length * 3 / 4), 0);
        if (upperBound > LIMIT) throw new Error(`recording exceeds ${LIMIT}-byte staging limit`);
        const chunks = record.chunks.map((part) => Uint8Array.from(atob(part), (ch) => ch.charCodeAt(0)));
        const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        if (length > LIMIT) throw new Error(`recording exceeds ${LIMIT}-byte staging limit`);
        const out = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
        return out;
      });
    },
    remove(key) {
      return serialized(async () => {
        if (!validKey(key)) throw new Error("invalid recording key");
        const index = decodeIndex(await port.get(INDEX));
        decode(await port.get(key)); // refuse to erase unknown future schemas
        await port.set(key, null);
        if (index.keys.includes(key)) await port.set(INDEX, { schema: 1, keys: index.keys.filter((candidate) => candidate !== key) });
      });
    },
    list(prefix) {
      return serialized(async () => {
        if (prefix !== PREFIX) throw new Error("recording listing is limited to its own namespace");
        return decodeIndex(await port.get(INDEX)).keys;
      });
    },
  };
}
