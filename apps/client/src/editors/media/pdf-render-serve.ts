// La resa delle pagine di un PDF fuori dal thread principale (#525). Il
// worker (`pdf-render-worker.ts`) apre lo stesso PDF con il suo pdf.js, ne
// disegna una pagina alla volta in un `OffscreenCanvas` e la manda indietro
// come `ImageBitmap`: il thread principale la mette nel canvas senza
// eseguire la pagina né caricare il canvas grande per il compositore.
//
// Qui c'è solo la regola, senza il worker vero: le parole fra i due lati e
// chi le serve. Il lato principale è `pdf-render-client.ts`.

/** Ciò che il thread principale chiede al worker. */
export type PdfRenderRequest =
  | { readonly type: "open"; readonly bytes: Uint8Array; readonly workerSrc: string; readonly version: string }
  | { readonly type: "render"; readonly id: number; readonly index: number; readonly scale: number };

/** Ciò che il worker risponde. */
export type PdfRenderReply =
  | { readonly type: "opened"; readonly pageCount: number }
  /** Il worker non sa disegnare (niente `OffscreenCanvas` 2d o font): si disegna nel thread principale. */
  | { readonly type: "unsupported"; readonly reason: string }
  /** Il PDF non si è aperto nel worker. */
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "rendered"; readonly id: number; readonly bitmap: ImageBitmap }
  /** Una richiesta più nuova l'ha interrotta prima della fine. */
  | { readonly type: "skipped"; readonly id: number }
  | { readonly type: "error"; readonly id: number; readonly message: string };

/** Il canvas del worker, stretto a ciò che serve. */
export interface RenderCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): unknown;
  transferToImageBitmap(): ImageBitmap;
}

/** Il pdf.js del worker, stretto a ciò che serve. */
export interface RendererPdfJs {
  version: string;
  getDocument(source: { data: Uint8Array; ownerDocument: unknown; verbosity: number }): {
    promise: Promise<{
      numPages: number;
      getPage(page: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number };
        render(options: { canvas: null; canvasContext: unknown; viewport: unknown }): { promise: Promise<void>; cancel(): void };
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

/** Ciò che il worker trova attorno a sé: il pdf.js, i canvas e i font. */
export interface RendererScope {
  /** Carica pdf.js e gli fa analizzare il PDF nello stesso thread, col worker di `workerSrc`. */
  loadPdfJs(workerSrc: string): Promise<RendererPdfJs>;
  /** Un canvas fuori dallo schermo; `null` se il worker non ne ha. */
  makeCanvas(): RenderCanvas | null;
  /** Dove pdf.js carica i font del PDF (`self.fonts`); senza, il testo non si disegna. */
  readonly fonts: unknown;
  post(reply: PdfRenderReply, transfer?: Transferable[]): void;
}

/// I messaggi di pdf.js che si scrivono nella console del worker: solo gli
/// errori, non l'avviso del worker finto che qui è voluto.
const PDFJS_ERRORS_ONLY = 0;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Chi serve le richieste nel worker. Una richiesta di resa nuova interrompe
 * quella in corso, che risponde `skipped`: conta solo l'ultima pagina chiesta.
 */
export function pdfRenderer(scope: RendererScope): (request: PdfRenderRequest) => Promise<void> {
  let opened: Awaited<ReturnType<RendererPdfJs["getDocument"]>["promise"]> | null = null;
  let canvas: RenderCanvas | null = null;
  let latest = 0;
  let running: { cancel(): void } | null = null;

  async function open(request: Extract<PdfRenderRequest, { type: "open" }>): Promise<void> {
    if (opened) return;
    canvas = scope.makeCanvas();
    if (!canvas || !canvas.getContext("2d")) return scope.post({ type: "unsupported", reason: "OffscreenCanvas 2d" });
    if (!scope.fonts) return scope.post({ type: "unsupported", reason: "fonts" });
    try {
      const pdfjs = await scope.loadPdfJs(request.workerSrc);
      if (pdfjs.version !== request.version) {
        return scope.post({ type: "failed", message: `pdf.js ${pdfjs.version} does not match required ${request.version}` });
      }
      // pdf.js crea i suoi canvas e carica i font da `ownerDocument`: nel
      // worker non c'è `document`, e glieli dà questo.
      const ownerDocument = {
        fonts: scope.fonts,
        createElement(name: string) {
          const made = name === "canvas" ? scope.makeCanvas() : null;
          if (!made) throw new Error(`no ${name} in the PDF worker`);
          return made;
        },
      };
      opened = await pdfjs.getDocument({ data: request.bytes, ownerDocument, verbosity: PDFJS_ERRORS_ONLY }).promise;
      scope.post({ type: "opened", pageCount: opened.numPages });
    } catch (error) {
      scope.post({ type: "failed", message: messageOf(error) });
    }
  }

  async function render(request: Extract<PdfRenderRequest, { type: "render" }>): Promise<void> {
    const { id } = request;
    latest = id;
    running?.cancel();
    running = null;
    if (!opened || !canvas) return scope.post({ type: "error", id, message: "PDF is not open in the worker" });
    if (request.index < 0 || request.index >= opened.numPages) return scope.post({ type: "error", id, message: "PDF page is unavailable" });
    try {
      const page = await opened.getPage(request.index + 1);
      if (id !== latest) return scope.post({ type: "skipped", id });
      const viewport = page.getViewport({ scale: request.scale });
      // Lo stesso canvas per ogni pagina: la misura nuova lo pulisce, e
      // `transferToImageBitmap` gli lascia una tela vuota.
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const task = page.render({ canvas: null, canvasContext: canvas.getContext("2d"), viewport });
      running = task;
      try {
        await task.promise;
      } finally {
        if (running === task) running = null;
      }
      if (id !== latest) return scope.post({ type: "skipped", id });
      const bitmap = canvas.transferToImageBitmap();
      scope.post({ type: "rendered", id, bitmap }, [bitmap]);
    } catch (error) {
      scope.post(id === latest ? { type: "error", id, message: messageOf(error) } : { type: "skipped", id });
    }
  }

  return (request) => (request.type === "open" ? open(request) : render(request));
}
