// Il lato principale del worker che disegna le pagine dei PDF (#525): apre il
// PDF nel worker, chiede una pagina alla volta e riceve la `ImageBitmap`.
// Le parole fra i due lati sono in `pdf-render-serve.ts`.

import type { PdfRenderReply, PdfRenderRequest } from "./pdf-render-serve";

/** Il worker, stretto a ciò che serve (un `Worker` vero, o uno finto nei test). */
export interface RenderWorkerLike {
  postMessage(message: PdfRenderRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<PdfRenderReply>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  terminate(): void;
}

export interface PdfRenderWorker {
  /**
   * La pagina `index` (da 0) a `scale` pixel per punto. `null` se una
   * richiesta più nuova l'ha superata; rifiuta se il worker non la disegna,
   * con `PdfRenderUnavailable` se il worker non si usa più.
   */
  render(index: number, scale: number): Promise<ImageBitmap | null>;
  destroy(): void;
}

/// Quanto si aspetta che il worker apra il PDF prima di lasciar perdere: le
/// pagine intanto si disegnano nel thread principale.
export const PDF_RENDER_OPEN_TIMEOUT_MS = 20_000;

/// Quanto si aspetta una pagina dal worker. La pagina più pesante dei PDF di
/// prova (scansioni, tracciati fitti) sta in qualche secondo anche su una
/// macchina lenta e carica; un worker fermo oltre questo tempo, senza aver
/// dato errore, è bloccato: non si usa più e la pagina si disegna qui, invece
/// di lasciare il visore sulla pagina vecchia per sempre.
export const PDF_RENDER_PAGE_TIMEOUT_MS = 10_000;

/// Il PDF più grande che si apre anche nel worker. Il worker tiene una sua
/// copia dei byte (da `getData()`) e un secondo pdf.js che li analizza: con un
/// PDF di 126 MB la WebView sale di 451 MB invece di 180 (misura in
/// `docs/misure/2026-11-20-linux-pdf-pagina-worker.md`), con uno di 60 MB di
/// 270 invece di 114: da due a due volte e mezza il file in più. Fino a 64 MiB
/// (circa 170 MB in più al massimo) il prezzo compra le pagine disegnate fuori
/// dal thread principale, che servono soprattutto alle scansioni; oltre, le
/// pagine si disegnano lì come prima del worker, senza la memoria doppia.
export const PDF_RENDER_WORKER_MAX_BYTES = 64 * 1024 * 1024;

/** Perché il worker non si usa: `unsupported` vale per tutta la WebView. */
export type PdfRenderDownReason = "unsupported" | "failed" | "timeout" | "crashed" | "closed";

/** Il worker non si usa: non sa disegnare, non ha aperto il PDF, è caduto o è chiuso. */
export class PdfRenderUnavailable extends Error {
  override readonly name = "PdfRenderUnavailable";
  constructor(readonly reason: PdfRenderDownReason, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

export interface PdfRenderOpenOptions {
  readonly openTimeoutMs?: number;
  readonly pageTimeoutMs?: number;
  /// Chiuso il documento: l'apertura rifiuta subito e il worker si chiude.
  readonly signal?: AbortSignal;
}

/**
 * Apre `bytes` nel worker; i byte passano al worker (`transfer`), e chi chiama
 * non li ha più. Rifiuta con `PdfRenderUnavailable` se il worker non sa
 * disegnare, non apre il PDF entro il tempo, cade o se `signal` lo chiude; in
 * ogni caso lo chiude, e chi chiama disegna nel thread principale.
 */
export function openPdfRenderWorker(
  worker: RenderWorkerLike,
  open: { readonly bytes: Uint8Array; readonly workerSrc: string; readonly version: string },
  options: PdfRenderOpenOptions = {},
): Promise<PdfRenderWorker> {
  const pageTimeoutMs = options.pageTimeoutMs ?? PDF_RENDER_PAGE_TIMEOUT_MS;
  let next = 0;
  let pending: { readonly id: number; resolve(bitmap: ImageBitmap | null): void; reject(error: Error): void } | null = null;
  let down: PdfRenderUnavailable | null = null;
  let opening: { resolve(handle: PdfRenderWorker): void; reject(error: Error): void } | null = null;

  const onAbort = () => fail("closed");
  const fail = (reason: PdfRenderDownReason, detail?: string) => {
    if (down) return;
    down = new PdfRenderUnavailable(reason, detail);
    options.signal?.removeEventListener("abort", onAbort);
    worker.terminate();
    pending?.reject(down);
    pending = null;
    opening?.reject(down);
    opening = null;
  };

  const handle: PdfRenderWorker = {
    render(index, scale) {
      if (down) return Promise.reject(down);
      // La richiesta di prima non serve più: chi l'aspetta ha `null`, e la sua
      // pagina, se arriva lo stesso, si butta.
      pending?.resolve(null);
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending?.id === id) fail("timeout", `page ${index + 1}`);
        }, pageTimeoutMs);
        pending = {
          id,
          resolve: (bitmap) => { clearTimeout(timer); resolve(bitmap); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        };
        worker.postMessage({ type: "render", id, index, scale });
      });
    },
    destroy() {
      fail("closed");
    },
  };

  worker.addEventListener("message", ({ data: reply }) => {
    switch (reply.type) {
      case "opened":
        opening?.resolve(handle);
        opening = null;
        return;
      case "unsupported":
        return fail("unsupported", reply.reason);
      case "failed":
        return fail("failed", reply.message);
      default: {
        const mine = pending && pending.id === reply.id ? pending : null;
        if (!mine) {
          if (reply.type === "rendered") reply.bitmap.close();
          return;
        }
        pending = null;
        if (reply.type === "rendered") mine.resolve(reply.bitmap);
        else if (reply.type === "skipped") mine.resolve(null);
        else mine.reject(new Error(reply.message));
      }
    }
  });
  worker.addEventListener("error", () => fail("crashed"));
  worker.addEventListener("messageerror", () => fail("crashed", "unreadable reply"));

  return new Promise<PdfRenderWorker>((resolve, reject) => {
    const timer = setTimeout(() => fail("timeout", "open"), options.openTimeoutMs ?? PDF_RENDER_OPEN_TIMEOUT_MS);
    opening = {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    };
    if (options.signal?.aborted) fail("closed");
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    if (down) return opening?.reject(down);
    worker.postMessage({ type: "open", ...open }, [open.bytes.buffer]);
  });
}
