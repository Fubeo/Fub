// La porta con cui le view media leggono i byte (P07/F23).
//
// Il backend serve chunk binari (`tauri::ipc::Response`, mai un array JSON di
// numeri) e il protocollo `fub-asset:` con `Range`; qui la forma che li chiede.
// Il trasporto si inietta (produzione: `transport.ts` di questo pacchetto con
// `invoke` da `host/ipc.ts`; test: un finto in memoria): nessun import Tauri
// in questo modulo ne' in quelli che lo usano, per la regola del §1.3.
// CanvasOwner riusa questa stessa porta con le sue porte opzionali iniettate,
// senza import diretti.
import { MEDIA_IPC_CHUNK, MEDIA_MAX_INLINE_BYTES, type ResourceDescriptor } from "./media-types";

/// Il lato byte del confine: apre, legge a chunk, chiude. Le tre firme che
/// Main registra (`resource_open`, `resource_read_chunk`, `resource_close`).
/// `read_chunk` torna i byte grezzi (ArrayBuffer lato trasporto); short-read
/// leciti, vuoto significa EOF — la stessa semantica di `TransferRead`.
export interface ResourceTransport {
  open(id: string, vault?: string): Promise<ResourceDescriptor>;
  read_chunk(handle: string, offset: number, len: number): Promise<ArrayBuffer>;
  close(handle: string): Promise<void>;
}

/// Una risorsa aperta con la sua porta: chi la tiene la chiude. `readAll`
/// assembla al massimo `MEDIA_MAX_INLINE_BYTES`, altrimenti rifiuta con un
/// errore che nomina il tetto (mai un OOM silenzioso). Lo streaming oltre il
/// tetto passa dal protocollo con `Range`, fuori da qui.
export interface ResourcePort {
  readonly descriptor: ResourceDescriptor;
  readAll(): Promise<Uint8Array>;
  close(): Promise<void>;
}


/** Apre una risorsa: da qui in poi chi la tiene la chiude (anche in errore). */
export async function openResourcePort(
  transport: ResourceTransport,
  id: string,
  vault?: string,
): Promise<ResourcePort> {
  const descriptor = await transport.open(id, vault);
  if (!Number.isSafeInteger(descriptor.len) || descriptor.len < 0) {
    await transport.close(descriptor.handle);
    throw new Error(`resource ${id} reports an unreadable length`);
  }
  const handle = descriptor.handle;
  let closed = false;
  return {
    descriptor,
    async readAll(): Promise<Uint8Array> {
      if (descriptor.len > MEDIA_MAX_INLINE_BYTES) {
        throw new Error(
          `resource ${descriptor.id} is ${descriptor.len} bytes, above the ${MEDIA_MAX_INLINE_BYTES}-byte inline limit: stream it over fub-asset: with Range`,
        );
      }
      const out = new Uint8Array(descriptor.len);
      let offset = 0;
      while (offset < descriptor.len) {
        const asked = Math.min(MEDIA_IPC_CHUNK, descriptor.len - offset);
        const raw = await transport.read_chunk(handle, offset, asked);
        const bytes = new Uint8Array(raw);
        if (bytes.byteLength === 0) throw new Error(`resource ${descriptor.id} ended before its declared ${descriptor.len} bytes`);
        if (bytes.byteLength > asked) throw new Error(`resource ${descriptor.id} returned an oversized chunk`);
        out.set(bytes, offset);
        offset += bytes.byteLength;
      }
      return out;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await transport.close(handle);
    },
  };
}

/**
 * Legge tutto e chiude sempre, anche in errore: la forma breve per le
 * anteprime una tantum (thumbnail, snippet audio, pagina PDF via pdf.js).
 */
export async function readAllResource(
  transport: ResourceTransport,
  id: string,
  vault?: string,
): Promise<{ descriptor: ResourceDescriptor; bytes: Uint8Array }> {
  const port = await openResourcePort(transport, id, vault);
  try {
    const bytes = await port.readAll();
    return { descriptor: port.descriptor, bytes };
  } finally {
    await port.close();
  }
}
