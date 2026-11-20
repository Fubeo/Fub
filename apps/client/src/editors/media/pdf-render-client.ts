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
   * richiesta più nuova l'ha superata; rifiuta se il worker non la disegna.
   */
  render(index: number, scale: number): Promise<ImageBitmap | null>;
  destroy(): void;
}

/// Quanto si aspetta che il worker apra il PDF prima di lasciar perdere: le
/// pagine intanto si disegnano nel thread principale.
export const PDF_RENDER_OPEN_TIMEOUT_MS = 20_000;

/** Il worker non si usa: non sa disegnare, non ha aperto il PDF, o è caduto. */
export class PdfRenderUnavailable extends Error {
  override readonly name = "PdfRenderUnavailable";
}

/**
 * Apre `bytes` nel worker. Rifiuta con `PdfRenderUnavailable` se il worker non
 * sa disegnare, non apre il PDF entro `timeoutMs` o cade; in ogni caso lo
 * chiude, e chi chiama disegna nel thread principale.
 */
export function openPdfRenderWorker(
  worker: RenderWorkerLike,
  open: { readonly bytes: Uint8Array; readonly workerSrc: string; readonly version: string },
  timeoutMs = PDF_RENDER_OPEN_TIMEOUT_MS,
): Promise<PdfRenderWorker> {
  let next = 0;
  let pending: { readonly id: number; resolve(bitmap: ImageBitmap | null): void; reject(error: Error): void } | null = null;
  let down: PdfRenderUnavailable | null = null;
  let opening: { resolve(handle: PdfRenderWorker): void; reject(error: Error): void } | null = null;

  const fail = (reason: string) => {
    if (down) return;
    down = new PdfRenderUnavailable(reason);
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
        pending = { id, resolve, reject };
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
        return fail(`unsupported: ${reply.reason}`);
      case "failed":
        return fail(reply.message);
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
  worker.addEventListener("messageerror", () => fail("unreadable reply"));

  return new Promise<PdfRenderWorker>((resolve, reject) => {
    const timer = setTimeout(() => fail("timeout"), timeoutMs);
    opening = {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    };
    if (down) return opening.reject(down);
    worker.postMessage({ type: "open", ...open }, [open.bytes.buffer]);
  });
}
