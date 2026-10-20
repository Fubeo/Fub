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

/** Un rettangolo di una pagina, in punti dall'angolo in alto a sinistra. */
export interface PdfArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Una voce del sommario del PDF: il titolo, la pagina (da 1) e le figlie. */
export interface PdfOutlineItem {
  readonly title: string;
  /** `null` se la destinazione non porta a una pagina di questo PDF. */
  readonly page: number | null;
  readonly items: readonly PdfOutlineItem[];
}

/** Una voce del sommario come si mostra in fila: titolo, pagina e profondità. */
export interface PdfOutlineRow {
  readonly title: string;
  readonly page: number;
  readonly depth: number;
}

/** Quante voci del sommario si mostrano al più. */
export const PDF_OUTLINE_LIMIT = 500;

/**
 * Il sommario in fila, nell'ordine di lettura: le voci senza pagina restano
 * fuori, le loro figlie no.
 */
export function outlineRows(items: readonly PdfOutlineItem[], depth = 0, out: PdfOutlineRow[] = []): PdfOutlineRow[] {
  for (const item of items) {
    if (out.length >= PDF_OUTLINE_LIMIT) break;
    if (item.page !== null) out.push({ title: item.title.trim() || "—", page: item.page, depth });
    outlineRows(item.items, depth + 1, out);
  }
  return out;
}

export interface PdfEngine {
  readonly pageCount: number;
  /** Il sommario, vuoto se il PDF non ne ha. Facoltativo: un motore senza non ne offre. */
  outline?(): Promise<PdfOutlineItem[]>;
  search(needle: string, limit?: number): Promise<PdfSearchHit[]>;
  renderPage(index: number, canvas: HTMLCanvasElement, scale?: number): Promise<void>;
  /** La misura della pagina `index` (da 0) in punti, girata come la si legge. */
  pageSize(index: number): Promise<readonly [number, number]>;
  /**
   * Disegna in `canvas` il rettangolo `area` della pagina `index`, a `scale`
   * pixel per punto: la parte che si vede di una pagina ingrandita. `false`
   * se una resa successiva l'ha interrotta, e allora il canvas è a metà.
   */
  renderArea(index: number, canvas: HTMLCanvasElement, scale: number, area: PdfArea): Promise<boolean>;
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
        getViewport(options: { scale: number; offsetX?: number; offsetY?: number }): { width: number; height: number };
        getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
        render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): {
          promise: Promise<void>;
          cancel(): void;
        };
      }>;
      destroy(): Promise<void>;
      getOutline?(): Promise<PdfJsOutline[] | null>;
      getDestination?(id: string): Promise<unknown[] | null>;
      getPageIndex?(ref: unknown): Promise<number>;
    }>;
    destroy(): Promise<void>;
  };
}

/** Una voce del sommario come la dà pdf.js. */
interface PdfJsOutline {
  title?: string;
  dest?: unknown;
  items?: PdfJsOutline[];
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
    // La pagina di una destinazione: per nome o già scritta, il cui primo
    // elemento è il riferimento alla pagina. Una che non si risolve non porta
    // da nessuna parte, e la voce resta senza pagina.
    const pageOf = async (dest: unknown): Promise<number | null> => {
      try {
        const explicit = typeof dest === "string" ? await document.getDestination?.(dest) : dest;
        if (!Array.isArray(explicit) || explicit.length === 0 || !document.getPageIndex) return null;
        const target = explicit[0];
        const index = typeof target === "number" ? target : await document.getPageIndex(target);
        return Number.isInteger(index) && index >= 0 && index < document.numPages ? index + 1 : null;
      } catch {
        return null;
      }
    };
    const outlineOf = async (items: readonly PdfJsOutline[], budget: { left: number }): Promise<PdfOutlineItem[]> => {
      const out: PdfOutlineItem[] = [];
      for (const item of items) {
        if (destroyed || budget.left <= 0) break;
        budget.left--;
        out.push({
          title: typeof item.title === "string" ? item.title : "",
          page: await pageOf(item.dest),
          items: await outlineOf(Array.isArray(item.items) ? item.items : [], budget),
        });
      }
      return out;
    };
    return {
      pageCount: document.numPages,
      async outline() {
        if (destroyed || !document.getOutline) return [];
        const items = await document.getOutline();
        return Array.isArray(items) ? outlineOf(items, { left: PDF_OUTLINE_LIMIT }) : [];
      },
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
      async pageSize(index) {
        if (destroyed || index < 0 || index >= document.numPages) throw new Error("PDF page is unavailable");
        const viewport = (await document.getPage(index + 1)).getViewport({ scale: 1 });
        return [viewport.width, viewport.height] as const;
      },
      async renderArea(index, canvas, scale, area) {
        if (destroyed || index < 0 || index >= document.numPages) throw new Error("PDF page is unavailable");
        const generation = ++renderGeneration;
        activeRender?.cancel();
        const page = await document.getPage(index + 1);
        if (destroyed || generation !== renderGeneration) return false;
        // Lo spostamento porta l'angolo dell'area nell'origine del canvas.
        const viewport = page.getViewport({ scale, offsetX: -area.x * scale, offsetY: -area.y * scale });
        canvas.width = Math.max(1, Math.ceil(area.width * scale));
        canvas.height = Math.max(1, Math.ceil(area.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF canvas is unavailable");
        const task = page.render({ canvas, canvasContext: context, viewport });
        activeRender = task;
        try {
          await task.promise;
          return !destroyed && generation === renderGeneration;
        } catch (error) {
          if (!destroyed && generation === renderGeneration) throw error;
          return false;
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
/// Lo spazio fra le due pagine affiancate, in pixel CSS: lo stesso del foglio.
const SPREAD_GAP = 16;
/// Il filtro dei colori scuri, sul canvas: non passa dal tema, che non
/// conosce `invert()`.
const DARK_FILTER = "invert(1) hue-rotate(180deg)";

export function mountPdfView(
  descriptor: ResourceDescriptor,
  bytes: Uint8Array,
  options: {
    loader?: PdfEngineLoader;
    initialPage?: number | null;
    onOpenExternal?: () => void | Promise<void>;
    onCopyLink?: (page: number) => void | Promise<void>;
    onAnnotate?: () => void | Promise<void>;
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
  // La seconda pagina, nella vista a due pagine.
  const facing = document.createElement("canvas");
  facing.hidden = true;
  const viewer = document.createElement("div");
  viewer.className = "media-pdf-page";
  viewer.append(canvas, facing);
  root.append(toolbar, status, viewer);

  let engine: PdfEngine | null = null;
  let page = options.initialPage ?? 1;
  let destroyed = false;
  /// «Adatta alla larghezza»: la pagina prende la larghezza del piano invece
  /// della sua misura in punti.
  let fit = false;
  let fitWidth = 0;
  /// Due pagine affiancate, come un libro aperto: la dispari a sinistra.
  let spread = false;

  /// La larghezza utile del piano, senza il suo margine interno.
  function available(): number {
    const style = getComputedStyle(viewer);
    return viewer.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  }

  /// Disegna la pagina `index` (da 0) in `target`; adattata, larga `room`.
  async function paint(index: number, target: HTMLCanvasElement, room: number, clamped: number): Promise<void> {
    if (!engine) return;
    const ratio = devicePixelRatio || 1;
    if (!fit) {
      await engine.renderPage(index, target, ratio);
      return;
    }
    const [width, height] = await engine.pageSize(index);
    const zoom = width > 0 && room > 0 ? room / width : 1;
    await engine.renderPage(index, target, ratio * zoom);
    if (destroyed || !fit || page !== clamped) return;
    target.style.width = `${width * zoom}px`;
    target.style.height = `${height * zoom}px`;
  }

  /// La prima pagina della coppia che contiene `n`.
  function spreadStart(n: number): number {
    return n % 2 === 0 ? n - 1 : n;
  }

  async function show(idx: number): Promise<void> {
    if (!engine || destroyed) return;
    const count = engine.pageCount || 1;
    let clamped = Math.min(Math.max(1, idx), count);
    if (spread) clamped = spreadStart(clamped);
    page = clamped;
    const second = spread && clamped < count ? clamped + 1 : null;
    status.textContent = second
      ? t("media.pdf.pages", { first: clamped, last: second, count: engine.pageCount })
      : t("media.pdf.page", { page: clamped, count: engine.pageCount });
    fitWidth = available();
    viewer.classList.toggle("media-pdf-spread", second !== null);
    facing.hidden = second === null;
    // Le due pagine si dividono il piano, meno lo spazio fra loro. Si
    // disegnano una dopo l'altra: il motore interrompe una resa quando ne
    // comincia un'altra.
    const room = second ? Math.max(0, (fitWidth - SPREAD_GAP) / 2) : fitWidth;
    await paint(clamped - 1, canvas, room, clamped);
    if (second && !destroyed && page === clamped) await paint(second - 1, facing, room, clamped);
  }

  function step(delta: -1 | 1): void {
    void show(page + delta * (spread ? 2 : 1)).catch(showFailed);
  }

  function showFailed(error: unknown): void {
    if (!destroyed) status.textContent = t("media.pdf.page_failed", { reason: errorText(error) });
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
  life.listen(prev, "click", () => step(-1));
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  life.listen(next, "click", () => step(1));
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
  // Il sommario, se il PDF ne ha uno: un elenco che porta alla pagina.
  const contents = document.createElement("select");
  contents.className = "media-pdf-outline";
  contents.setAttribute("aria-label", t("media.pdf.outline"));
  contents.hidden = true;
  life.listen(contents, "change", () => {
    const target = Number(contents.value);
    contents.selectedIndex = 0;
    if (Number.isInteger(target) && target > 0) void show(target).catch(showFailed);
  });
  const fitButton = document.createElement("button");
  fitButton.type = "button";
  fitButton.textContent = t("media.pdf.fit_width");
  fitButton.setAttribute("aria-pressed", "false");
  life.listen(fitButton, "click", () => {
    fit = !fit;
    fitButton.setAttribute("aria-pressed", String(fit));
    void show(page).catch(showFailed);
  });
  const spreadButton = document.createElement("button");
  spreadButton.type = "button";
  spreadButton.textContent = t("media.pdf.two_pages");
  spreadButton.setAttribute("aria-pressed", "false");
  life.listen(spreadButton, "click", () => {
    spread = !spread;
    spreadButton.setAttribute("aria-pressed", String(spread));
    void show(page).catch(showFailed);
  });
  // I colori del tema scuro: la pagina si inverte, e il giro di tinta riporta
  // i colori al loro tono (il rosso resta rosso, su fondo scuro).
  const darkButton = document.createElement("button");
  darkButton.type = "button";
  darkButton.textContent = t("media.pdf.dark");
  darkButton.setAttribute("aria-pressed", "false");
  life.listen(darkButton, "click", () => {
    const dark = darkButton.getAttribute("aria-pressed") !== "true";
    darkButton.setAttribute("aria-pressed", String(dark));
    for (const target of [canvas, facing]) target.style.filter = dark ? DARK_FILTER : "";
  });
  // Il piano cambia larghezza (la finestra, una barra laterale): la pagina
  // adattata si ridisegna, ma non per il pixel che la barra di scorrimento
  // sposta.
  let resize: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resize = new ResizeObserver(() => {
      if (fit && Math.abs(available() - fitWidth) > 16) void show(page).catch(showFailed);
    });
    resize.observe(viewer);
  }
  life.add(() => resize?.disconnect());
  toolbar.append(prev, next, contents, search, fitButton, spreadButton, darkButton);
  if (options.onAnnotate) {
    const annotate = document.createElement("button");
    annotate.type = "button";
    annotate.className = "media-pdf-annotate";
    annotate.textContent = t("media.pdf.annotate");
    life.listen(annotate, "click", () => invokeAction(() => options.onAnnotate?.()));
    toolbar.append(annotate);
  }
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
        void showOutline(loaded);
      })
      .catch((error) => {
        if (!destroyed) fallback(`PDF ${descriptor.id} could not be opened: ${errorText(error)}`);
      });
  }

  async function showOutline(loaded: PdfEngine): Promise<void> {
    let rows: PdfOutlineRow[];
    try {
      rows = outlineRows((await loaded.outline?.()) ?? []);
    } catch {
      // Un sommario rotto non ferma la lettura: l'elenco resta nascosto.
      return;
    }
    if (destroyed || engine !== loaded || rows.length === 0) return;
    const head = document.createElement("option");
    head.value = "";
    head.textContent = t("media.pdf.outline");
    contents.replaceChildren(head, ...rows.map((row) => {
      const item = document.createElement("option");
      item.value = String(row.page);
      item.textContent = `${"\u00a0\u00a0".repeat(row.depth)}${row.title} · ${row.page}`;
      return item;
    }));
    contents.hidden = false;
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
