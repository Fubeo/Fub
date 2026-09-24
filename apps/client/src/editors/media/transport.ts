// Il trasporto IPC delle risorse: la cucitura che FrontendIntegration cabla.
//
// NESSUN import `@tauri-apps` in questo pacchetto (§1.3: solo `host/ipc.ts` e
// `host/dialog.ts` possono importarlo, e il test `no-tauri-outside-host` lo
// presidia leggendo i sorgenti). La `invoke` di Tauri arriva iniettata da
// `host/ipc.ts`, che registra questi nomi di comando via NativeIntegration:
// `resource_open`, `resource_read_chunk` (risposta binaria -> ArrayBuffer, mai
// array JSON di numeri), `resource_close`, `resource_write` (corpo `Uint8Array`
// grezzo + metadati in header, mai base64/JSON), `viewer_open`.
import type { ResourceDescriptor } from "./media-types";
import type { ResourceTransport } from "./resource-port";
import type { AttachmentDeposit } from "./attachment-target";

/// La ricevuta di un deposito binario riuscito: id fenced scritto + revisione
/// dei byte (`Revision::of_bytes`). Niente handle: chi vuole leggere apre la
/// risorsa separatamente. Gemella di `ResourceWriteReceipt` in
/// `crates/fub-host/src/resources.rs` (id/revision stringhe canoniche).
export interface ResourceWriteReceipt {
  readonly id: string;
  readonly revision: string;
}

/// La `invoke` nativa, iniettata da `host/ipc.ts` (l'unico modulo che importa
/// il core Tauri). Corpo binario (`Uint8Array`/`ArrayBuffer`) e terzo argomento
/// headers compatibile Tauri; il pacchetto media non importa il backend.
export type TauriInvoke = <T>(
  cmd: string,
  args?: Uint8Array | ArrayBuffer | Record<string, unknown>,
  options?: { headers?: Record<string, string> },
) => Promise<T>;

/// Nome dell'header che porta i metadati del deposito (gemello Rust
/// `RESOURCE_WRITE_HEADER`): l'unico parametro JSON di `resource_write`.
export const RESOURCE_WRITE_HEADER = "x-fub-resource-write";

/** Il trasporto sopra i comandi reali, con `invoke` iniettata. */
export function makeResourceTransport(invoke: TauriInvoke, vault?: string): ResourceTransport {
  return {
    open: (id: string, scope?: string) =>
      invoke<ResourceDescriptor>("resource_open", {
        id,
        vault: scope ?? vault ?? null,
      }),
    read_chunk: async (handle: string, offset: number, len: number): Promise<ArrayBuffer> => {
      const raw = await invoke<unknown>("resource_read_chunk", { handle, offset, len });
      if (raw instanceof ArrayBuffer) return raw;
      if (raw instanceof Uint8Array) {
        return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      }
      throw new Error(
        "resource_read_chunk did not return binary bytes: the IPC bridge is not serving Response",
      );
    },
    close: (handle: string) => invoke<void>("resource_close", { handle }).then(() => {}),
  };
}

/**
 * Deposita byte veri via corpo grezzo + metadati in header, mai JSON/base64.
 * `expected`: null = create-only atomico (mai overwrite), stringa = CAS sulla
 * revisione del descrittore. Forma: `invoke("resource_write", bytes, {
 * headers: { "x-fub-resource-write": encodeURIComponent(JSON.stringify({ id,
 * vault: vault ?? null, expected })) } })`. Torna la ricevuta, non un handle:
 * fallire l'open dopo non fa fallire il deposito.
 */
export async function writeResource(
  invoke: TauriInvoke,
  id: string,
  bytes: Uint8Array,
  expected: string | null,
  vault?: string,
): Promise<ResourceWriteReceipt> {
  const meta = encodeURIComponent(JSON.stringify({ id, vault: vault ?? null, expected }));
  return invoke<ResourceWriteReceipt>("resource_write", bytes, {
    headers: { [RESOURCE_WRITE_HEADER]: meta },
  });
}

/** Binds paste/drop/recorder deposits to the native create-only write. */
export function makeAttachmentDeposit(
  invoke: TauriInvoke,
  folder: string,
  fromDocument: string,
  vault?: string,
): AttachmentDeposit {
  return {
    folder,
    fromDocument,
    write: (id, bytes) => writeResource(invoke, id, bytes, null, vault),
  };
}

/** Open only under an explicit remote policy; native rechecks every URL. */
export async function openViewer(
  invoke: TauriInvoke,
  url: string,
  title: string,
  policy: { allowRemote: boolean; allowlist: readonly string[] },
): Promise<string> {
  return invoke<string>("viewer_open", {
    open: { url, title, allow_remote: policy.allowRemote, allowlist: [...policy.allowlist] },
  });
}

/** Explicit save gesture; the native host checks the same policy before fetching. */
export function saveViewer(
  invoke: TauriInvoke,
  url: string,
  title: string,
  allowlist: readonly string[],
  attachmentFolder: string,
  vault?: string,
): Promise<ResourceWriteReceipt> {
  return invoke<ResourceWriteReceipt>("viewer_save", {
    url, title, allowlist: [...allowlist], attachmentFolder, vault: vault ?? null,
  });
}

/** Il riferimento al loader pdf.js in bundle (entry + worker locali, mai CDN). */
export const PDF_LOADER_REF = {
  version: "6.3.289",
  entry: "pdf.min.mjs",
  worker: "pdf.worker.min.mjs",
} as const;
