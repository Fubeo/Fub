// PDF canvas surface with search and page links. The optional injected
// pdf.js adapter requires a local worker and an exact version match; absent
// the dependency it shows an honest fallback, never a browser PDF iframe.
// PDF bytes are inline-bounded; oversized PDF currently reports the limit
// rather than pretending that a full-buffer loader supports Range streaming.
// Document printing is a separate print-target render, not a canvas capture.

import type { Lifetime } from "../../ui/lifetime";
import type { ResourceDescriptor } from "./media-types";
import { t } from "../../i18n/strings";
import { errorText } from "../../host/errors";

/// Required local pdf.js version. Composition installs/bundles the dependency
/// and worker; this module never fetches a CDN or fabricates a loader.
export const PDFJS_VERSION = "6.3.289";


export interface PdfSearchHit {
  readonly page: number;
  readonly snippet: string;
}

export interface PdfEngine {
  readonly pageCount: number;
  search(needle: string, limit?: number): Promise<PdfSearchHit[]>;
  renderPage(index: number, canvas: HTMLCanvasElement, scale?: number): Promise<void>;
  destroy(): void;
}

export type PdfEngineLoader = (bytes: Uint8Array) => Promise<PdfEngine>;

/** Narrow pdf.js API. Composition injects a lazy import and its bundled worker URL. */
export interface PdfJsModule {
  version: string;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(source: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(page: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number };
        getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
        render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): {
          promise: Promise<void>;
          cancel(): void;
        };
      }>;
      destroy(): Promise<void>;
    }>;
    destroy(): Promise<void>;
  };
}

export function makePdfJsLoader(
  importModule: () => Promise<PdfJsModule>,
  workerUrl: string,
): PdfEngineLoader {
  return async (bytes) => {
    if (!workerUrl) throw new Error("PDF worker must be bundled locally");
    const worker = new URL(workerUrl, location.href);
    if (worker.origin !== location.origin || !["http:", "https:", "tauri:"].includes(worker.protocol)) {
      throw new Error("PDF worker must be bundled on the local app origin");
    }
    const pdfjs = await importModule();
    if (pdfjs.version !== PDFJS_VERSION) {
      throw new Error(`pdf.js ${pdfjs.version} does not match required ${PDFJS_VERSION}`);
    }
    pdfjs.GlobalWorkerOptions.workerSrc = worker.href;
    const loading = pdfjs.getDocument({ data: bytes });
    let document: Awaited<typeof loading.promise>;
    try {
      document = await loading.promise;
    } catch (error) {
      await loading.destroy();
      throw error;
    }
    let destroyed = false;
    let activeRender: { cancel(): void } | null = null;
    let renderGeneration = 0;
    return {
      pageCount: document.numPages,
      async search(needle, limit = 20) {
        if (destroyed || !needle.trim()) return [];
        const hits: PdfSearchHit[] = [];
        for (let index = 0; index < document.numPages && hits.length < limit; index++) {
          const page = await document.getPage(index + 1);
          const content = await page.getTextContent();
          const text = content.items.map((item) => item.str ?? "").join(" ");
          const found = text.toLowerCase().indexOf(needle.toLowerCase());
          if (found >= 0) hits.push({
            page: index + 1,
            snippet: text.slice(Math.max(0, found - 40), found + needle.length + 40),
          });
        }
        return hits;
      },
      async renderPage(index, canvas, scale = 1) {
        if (destroyed || index < 0 || index >= document.numPages) throw new Error("PDF page is unavailable");
        const generation = ++renderGeneration;
        activeRender?.cancel();
        const page = await document.getPage(index + 1);
        if (destroyed || generation !== renderGeneration) return;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${viewport.width / scale}px`;
        canvas.style.height = `${viewport.height / scale}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF canvas is unavailable");
        const task = page.render({ canvas, canvasContext: context, viewport });
        activeRender = task;
        try {
          await task.promise;
        } catch (error) {
          if (!destroyed && generation === renderGeneration) throw error;
        } finally {
          if (activeRender === task) activeRender = null;
        }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        renderGeneration++;
        activeRender?.cancel();
        void document.destroy();
      },
    };
  };
}

/** Il frammento `#page=3` / `?page=3` di un DocId: 1-based, come i lettori. */
export function pdfPageFromFragment(id: string): number | null {
  const hash = id.indexOf("#");
  const query = id.indexOf("?");
  let fragment = "";
  if (hash >= 0) fragment = id.slice(hash + 1);
  else if (query >= 0) fragment = id.slice(query + 1);
  if (!fragment) return null;
  const match = /(?:^|&)page=(\d+)/.exec(fragment);
  if (!match) return null;
  const page = Number(match[1]);
  if (!Number.isSafeInteger(page) || page < 1) return null;
  return page;
}

/** L'id senza frammento: `doc/manuale.pdf#page=3` nomina il PDF. */
export function pdfIdWithoutFragment(id: string): string {
  const hash = id.indexOf("#");
  const query = id.indexOf("?");
  const cut = hash >= 0 ? hash : query;
  return cut >= 0 ? id.slice(0, cut) : id;
}

export interface PdfView {
  readonly element: HTMLElement;
  goToPage(page: number): Promise<void>;
  search(needle: string): Promise<PdfSearchHit[]>;
  destroy(): void;
}

/**
 * Monta il lettore: toolbar (pagina, ricerca, apri-esterno), canvas, stato.
 * Il loader e' iniettato (produzione: pdf.js; test: finto): senza loader la
 * view mostra il fallback con le istruzioni di installazione, mai un riquadro
 * vuoto e mai un viewer del browser.
 */
export function mountPdfView(
  descriptor: ResourceDescriptor,
  bytes: Uint8Array,
  options: {
    loader?: PdfEngineLoader;
    initialPage?: number | null;
    onOpenExternal?: () => void | Promise<void>;
    onCopyLink?: (page: number) => void | Promise<void>;
  },
  life: Lifetime,
): PdfView {
  const root = document.createElement("div");
  root.className = "media-pdf";
  root.tabIndex = 0;
  root.setAttribute("role", "document");

  const toolbar = document.createElement("div");
  toolbar.className = "media-pdf-toolbar";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const canvas = document.createElement("canvas");
  const viewer = document.createElement("div");
  viewer.className = "media-pdf-page";
  viewer.append(canvas);
  root.append(toolbar, status, viewer);

  let engine: PdfEngine | null = null;
  let page = options.initialPage ?? 1;
  let destroyed = false;

  async function show(idx: number): Promise<void> {
    if (!engine || destroyed) return;
    const clamped = Math.min(Math.max(1, idx), engine.pageCount || 1);
    page = clamped;
    status.textContent = t("media.pdf.page", { page: clamped, count: engine.pageCount });
    await engine.renderPage(clamped - 1, canvas, devicePixelRatio || 1);
  }

  function invokeAction(action: () => void | Promise<void>): void {
    void Promise.resolve().then(action).catch((error) => {
      if (!destroyed) status.textContent = t("media.pdf.failed", { reason: errorText(error) });
    });
  }

  function fallback(reason: string): void {
    status.textContent = reason;
    const note = document.createElement("p");
    note.textContent = t("media.pdf.unavailable", { version: PDFJS_VERSION, id: descriptor.id, mime: descriptor.mime });
    viewer.replaceChildren(note);
    if (options.onOpenExternal) {
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = t("media.open_external");
      life.listen(open, "click", () => invokeAction(() => options.onOpenExternal?.()));
      viewer.append(open);
    }
  }

  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "‹";
  life.listen(prev, "click", () => void show(page - 1).catch((error) => {
    if (!destroyed) status.textContent = t("media.pdf.page_failed", { reason: errorText(error) });
  }));
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  life.listen(next, "click", () => void show(page + 1).catch((error) => {
    if (!destroyed) status.textContent = t("media.pdf.page_failed", { reason: errorText(error) });
  }));
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = t("media.pdf.search");
  life.listen(search, "change", () => {
    if (!engine || destroyed) return;
    const needle = search.value;
    void engine.search(needle, 20).then((hits) => {
      if (destroyed) return;
      status.textContent =
        hits.length === 0
          ? t("media.pdf.no_matches", { needle })
          : t("media.pdf.matches", { count: hits.length, page: hits[0]!.page });
    }).catch((error) => {
      if (!destroyed) status.textContent = t("media.pdf.search_failed", { reason: errorText(error) });
    });
  });
  toolbar.append(prev, next, search);
  if (options.onOpenExternal) {
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = t("media.open_external");
    life.listen(open, "click", () => invokeAction(() => options.onOpenExternal?.()));
    toolbar.append(open);
  }
  if (options.onCopyLink) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = t("media.pdf.copy_link");
    life.listen(copy, "click", () => invokeAction(() => options.onCopyLink?.(page)));
    toolbar.append(copy);
  }

  if (!options.loader) {
    fallback(t("media.pdf.no_engine"));
  } else if (bytes.byteLength === 0) {
    fallback(t("media.pdf.empty", { id: descriptor.id }));
  } else {
    status.textContent = t("media.loading", { id: descriptor.id });
    void options
      .loader(bytes)
      .then((loaded) => {
        if (destroyed) {
          loaded.destroy();
          return;
        }
        engine = loaded;
        if (engine.pageCount === 0) {
          fallback(`PDF ${descriptor.id} has no pages.`);
          return;
        }
        void show(page).catch(() => fallback(`PDF ${descriptor.id} failed to render page ${page}.`));
      })
      .catch((error) => {
        if (!destroyed) fallback(`PDF ${descriptor.id} could not be opened: ${errorText(error)}`);
      });
  }

  life.add(() => {
    destroyed = true;
    engine?.destroy();
    engine = null;
    root.remove();
  });

  return {
    element: root,
    goToPage: (n: number) => show(n),
    search: async (needle: string) => (engine && !destroyed ? engine.search(needle, 20) : []),
    destroy: () => life.close(),
  };
}
