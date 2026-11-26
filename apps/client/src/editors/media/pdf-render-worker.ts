// Il worker che disegna le pagine dei PDF fuori dal thread principale (#525):
// solo l'aggancio a `self`, la regola è in `pdf-render-serve.ts`. Lo crea
// `bootstrap.ts` al primo PDF, e il motore (`pdf-view.ts`) lo chiude con il
// documento.

import * as pdfjs from "pdfjs-dist/build/pdf.min.mjs";
import { pdfRenderer, type PdfRenderReply, type PdfRenderRequest, type RendererPdfJs } from "./pdf-render-serve";

interface WorkerSelf {
  fonts?: unknown;
  pdfjsWorker?: unknown;
  postMessage(message: PdfRenderReply, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<PdfRenderRequest>) => void): void;
}

const scope = self as unknown as WorkerSelf;

const serve = pdfRenderer({
  async loadPdfJs(workerSrc) {
    // Con il gestore del worker di pdf.js già caricato, pdf.js analizza il PDF
    // in questo stesso thread invece di aprire un altro worker. L'indirizzo è
    // quello che il thread principale ha già controllato (origine dell'app).
    scope.pdfjsWorker = await import(/* @vite-ignore */ workerSrc);
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    return pdfjs as unknown as RendererPdfJs;
  },
  makeCanvas: () => (typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : null),
  fonts: scope.fonts,
  post: (reply, transfer) => scope.postMessage(reply, transfer ?? []),
});

scope.addEventListener("message", (event) => void serve(event.data));
