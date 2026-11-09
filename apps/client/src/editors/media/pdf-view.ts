// PDF canvas surface with search and page links. The optional injected
// pdf.js adapter requires a local worker and an exact version match; absent
// the dependency it shows an honest fallback, never a browser PDF iframe.
// PDF bytes are inline-bounded; oversized PDF currently reports the limit
// rather than pretending that a full-buffer loader supports Range streaming.
// Document printing is a separate print-target render, not a canvas capture.

import type { Lifetime } from "../../ui/lifetime";
import type { ResourceDescriptor } from "./media-types";
import { t, type Key } from "../../i18n/strings";
import { errorText } from "../../host/errors";
import { rovingToolbar } from "../../kit/toolbar-keys";
import { iconEl } from "../../ui/icons";
import { showContextMenu, type MenuItem } from "../../ui/menu";
import { attachTooltip } from "../../ui/tooltip";
import { useMediaIcons } from "./icons";

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
  /**
   * Una miniatura della pagina `index` (da 0), larga `width` pixel CSS. Non
   * interrompe la resa della pagina. Facoltativa: senza, niente miniature.
   */
  renderThumbnail?(index: number, canvas: HTMLCanvasElement, width: number): Promise<void>;
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
    const thumbnails = new Set<{ cancel(): void }>();
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
      async renderThumbnail(index, canvas, width) {
        if (destroyed || index < 0 || index >= document.numPages) throw new Error("PDF page is unavailable");
        const page = await document.getPage(index + 1);
        if (destroyed) return;
        const ratio = globalThis.devicePixelRatio || 1;
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: natural.width > 0 ? (width / natural.width) * ratio : ratio });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${viewport.height / ratio}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF canvas is unavailable");
        const task = page.render({ canvas, canvasContext: context, viewport });
        thumbnails.add(task);
        try {
          await task.promise;
        } catch (error) {
          if (!destroyed) throw error;
        } finally {
          thumbnails.delete(task);
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
        for (const task of thumbnails) task.cancel();
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

/** Dove si legge: la pagina davanti, la compagna nella vista a due pagine, quante sono. */
export interface PdfWhere {
  readonly first: number;
  /// La seconda pagina affiancata, o `null` con una pagina sola davanti.
  readonly last: number | null;
  readonly count: number;
}

/** «Pagina N di M», o «Pagine N–N+1 di M» con due pagine affiancate. */
export function pdfWhereText(where: PdfWhere): string {
  return where.last === null
    ? t("media.pdf.page", { page: where.first, count: where.count })
    : t("media.pdf.pages", { first: where.first, last: where.last, count: where.count });
}

/**
 * Le annotazioni di un PDF, pronte per le pagine del visore: le dà il modulo
 * delle annotazioni (`pdf-annotations.ts`), caricato solo quando servono.
 */
export interface PdfAnnotationLayers {
  /**
   * Il documento SVG che disegna sopra la pagina `page` (da 1) le sue
   * annotazioni, largo e alto `size` punti (la pagina del PDF; `null` se il
   * PDF non la dice). `null` se la pagina non ne ha.
   */
  layer(page: number, size: readonly [number, number] | null): string | null;
}

export interface PdfView {
  readonly element: HTMLElement;
  /// La pagina che si legge adesso.
  page(): number;
  /// Dove si legge, o `null` finché nessuna pagina si mostra (in caricamento,
  /// o un PDF che non si apre).
  where(): PdfWhere | null;
  goToPage(page: number): Promise<void>;
  search(needle: string): Promise<PdfSearchHit[]>;
  /// Quante pagine ha il PDF, appena il motore l'ha aperto; `null` se non si
  /// apre.
  pageCount(): Promise<number | null>;
  /**
   * Le annotazioni sopra le pagine, in sola lettura, o `null` per non
   * disegnarne. Con le annotazioni c'è l'interruttore «Mostra le
   * annotazioni». `note` è la riga che le riguarda (il PDF cambiato, un file
   * che non si legge), o `null`.
   */
  setAnnotations(layers: PdfAnnotationLayers | null, note: string | null): void;
  destroy(): void;
}

/**
 * Monta il lettore: la barra (pagine, miniature, sommario, ricerca, vista e
 * «…»), canvas, stato. La pagina davanti la dice `where()`, e `onPage` avvisa
 * quando cambia: la superficie la porta nella banda.
 * Il loader e' iniettato (produzione: pdf.js; test: finto): senza loader la
 * view mostra il fallback con le istruzioni di installazione, mai un riquadro
 * vuoto e mai un viewer del browser.
 */
/// Lo spazio fra le due pagine affiancate, in pixel CSS: lo stesso del foglio.
const SPREAD_GAP = 16;
/// Il filtro dei colori scuri, sul canvas: non passa dal tema, che non
/// conosce `invert()`. Un'inversione non piena lascia il fondo grigio scuro,
/// non nero.
const DARK_FILTER = "invert(0.9) hue-rotate(180deg)";
/// Il posto di una pagina nel piano: il canvas, lo strato delle annotazioni
/// sopra e il blob che lo disegna.
interface PageSheet {
  readonly box: HTMLSpanElement;
  mark: HTMLImageElement | null;
  url: string | null;
  drawn: string | null;
  page: number | null;
}
/// La larghezza di una miniatura, in pixel CSS.
const PDF_THUMB_WIDTH = 96;
/// Oltre, le miniature non si fanno: un PDF di diecimila pagine si percorre
/// col numero e col sommario.
export const PDF_THUMB_LIMIT = 2000;
/// Senza `IntersectionObserver`, le prime che si disegnano subito.
const PDF_THUMB_EAGER = 24;

export function mountPdfView(
  descriptor: ResourceDescriptor,
  bytes: Uint8Array,
  options: {
    loader?: PdfEngineLoader;
    initialPage?: number | null;
    onOpenExternal?: () => void | Promise<void>;
    onCopyLink?: (page: number) => void | Promise<void>;
    onAnnotate?: () => void | Promise<void>;
    /// La pagina davanti è cambiata, o non c'è più: `where()` dice quale.
    onPage?: () => void;
  },
  life: Lifetime,
): PdfView {
  const root = document.createElement("div");
  root.className = "media-pdf";
  root.tabIndex = 0;
  root.setAttribute("role", "document");

  // La barra è la barra in una fila del kit (`kit-bar`): i foglietti, le
  // figure, un solo punto di Tab e le frecce (`kit/toolbar-keys.ts`).
  const toolbar = document.createElement("div");
  toolbar.className = "media-pdf-toolbar kit-bar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", t("media.pdf.toolbar"));
  life.add(useMediaIcons());
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  // La riga delle annotazioni: il PDF cambiato dopo di loro, o un file che
  // non si legge. Sta sotto quella del visore, che la ricerca e la pagina
  // riscrivono.
  const marksNote = document.createElement("p");
  marksNote.className = "media-pdf-note";
  marksNote.setAttribute("role", "status");
  marksNote.hidden = true;
  const canvas = document.createElement("canvas");
  // La seconda pagina, nella vista a due pagine.
  const facing = document.createElement("canvas");
  facing.hidden = true;
  const front = pageSheet(canvas);
  const back = pageSheet(facing);
  back.box.hidden = true;
  const viewer = document.createElement("div");
  viewer.className = "media-pdf-page";
  // Il piano scorre e tiene solo canvas: senza un posto nell'ordine del
  // fuoco, con la tastiera non si percorre. Ha il nome della pagina che
  // mostra, che `show` aggiorna.
  viewer.tabIndex = 0;
  viewer.setAttribute("role", "region");
  viewer.append(front.box, back.box);
  // Le miniature, a lato del piano: si disegnano quando entrano in vista.
  const thumbs = document.createElement("nav");
  thumbs.className = "media-pdf-thumbs";
  thumbs.setAttribute("aria-label", t("media.pdf.thumbnails"));
  thumbs.hidden = true;
  const body = document.createElement("div");
  body.className = "media-pdf-body";
  body.append(thumbs, viewer);
  root.append(toolbar, status, marksNote, body);

  let engine: PdfEngine | null = null;
  let page = options.initialPage ?? 1;
  let destroyed = false;
  /// «Adatta alla larghezza»: la pagina prende la larghezza del piano invece
  /// della sua misura in punti.
  let fit = false;
  let fitWidth = 0;
  /// Due pagine affiancate, come un libro aperto: la dispari a sinistra.
  let spread = false;
  let dark = false;
  /// Dove si legge: `null` finché nessuna pagina si mostra.
  let where: PdfWhere | null = null;
  /// Le annotazioni sopra le pagine, e se si mostrano: accese a ogni
  /// apertura, come i colori chiari.
  let layers: PdfAnnotationLayers | null = null;
  let marksShown = true;
  /// Il giro dello strato delle annotazioni: uno più nuovo copre i vecchi.
  let marking = 0;
  let resolveCount: (count: number | null) => void = () => {};
  const counted = new Promise<number | null>((resolve) => {
    resolveCount = resolve;
  });

  /// Una frase nella riga di stato. La pagina la dice la banda della
  /// superficie: nella riga resta per il lettore di schermo (`quiet`). Il
  /// caricamento, gli errori e la ricerca si vedono.
  function say(text: string, quiet = false): void {
    status.textContent = text;
    status.classList.toggle("sr-only", quiet);
  }

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
    where = { first: clamped, last: second, count: engine.pageCount };
    const text = pdfWhereText(where);
    say(text, true);
    viewer.setAttribute("aria-label", text);
    markThumbs(clamped, second);
    markSteps();
    options.onPage?.();
    fitWidth = available();
    viewer.classList.toggle("media-pdf-spread", second !== null);
    facing.hidden = second === null;
    back.box.hidden = second === null;
    // Lo strato di un'altra pagina non resta sopra quella che si ridisegna.
    if (front.page !== clamped) drawMark(front, null, clamped);
    if (back.page !== second) drawMark(back, null, second);
    // Le due pagine si dividono il piano, meno lo spazio fra loro. Si
    // disegnano una dopo l'altra: il motore interrompe una resa quando ne
    // comincia un'altra.
    const room = second ? Math.max(0, (fitWidth - SPREAD_GAP) / 2) : fitWidth;
    await paint(clamped - 1, canvas, room, clamped);
    if (second && !destroyed && page === clamped) await paint(second - 1, facing, room, clamped);
    if (!destroyed && page === clamped) await drawMarks();
  }

  /// Lo strato delle annotazioni sopra le pagine che si vedono, alla misura
  /// della pagina del PDF: spento, o senza annotazioni, le pagine sono il
  /// PDF e basta.
  async function drawMarks(): Promise<void> {
    const token = ++marking;
    const loaded = engine;
    const shown = where;
    for (const [sheet, number] of [[front, shown?.first ?? null], [back, shown?.last ?? null]] as const) {
      if (!loaded || number === null || !layers || !marksShown) {
        drawMark(sheet, null, number);
        continue;
      }
      let size: readonly [number, number] | null = null;
      try {
        size = await loaded.pageSize(number - 1);
      } catch {
        // La misura scritta nelle annotazioni, o A4.
      }
      if (destroyed || token !== marking || !layers) return;
      drawMark(sheet, layers.layer(number, size), number);
    }
  }

  function step(delta: -1 | 1): void {
    void show(page + delta * (spread ? 2 : 1)).catch(showFailed);
  }

  function showFailed(error: unknown): void {
    if (!destroyed) say(t("media.pdf.page_failed", { reason: errorText(error) }));
  }

  function invokeAction(action: () => void | Promise<void>): void {
    void Promise.resolve().then(action).catch((error) => {
      if (!destroyed) say(t("media.pdf.failed", { reason: errorText(error) }));
    });
  }

  function fallback(reason: string): void {
    say(reason);
    // Nessuna pagina si mostra: la banda non ne dice nessuna.
    if (where !== null) {
      where = null;
      markSteps();
      options.onPage?.();
    }
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

  /// Un foglietto della barra: un gruppo senza nome, come nella barra di serie.
  function sheet(...controls: HTMLElement[]): HTMLSpanElement {
    const group = document.createElement("span");
    group.className = "media-pdf-group kit-bar-group";
    group.setAttribute("role", "group");
    group.append(...controls);
    return group;
  }

  /// Un pulsante a figura: il nome accessibile e il suggerimento sono le
  /// parole di sempre. Senza la figura (un tema che non la disegna) il nome
  /// resta scritto.
  function figure(name: string, label: Key, pressed?: boolean): HTMLButtonElement {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "kit-bar-button";
    control.tabIndex = -1;
    control.setAttribute("aria-label", t(label));
    if (pressed !== undefined) control.setAttribute("aria-pressed", String(pressed));
    const drawn = iconEl(name);
    if (drawn) control.append(drawn);
    else control.textContent = t(label);
    life.add(attachTooltip(control, t(label)));
    return control;
  }

  const prev = figure("media-page-previous", "media.pdf.previous");
  prev.disabled = true;
  life.listen(prev, "click", () => step(-1));
  const next = figure("media-page-next", "media.pdf.next");
  next.disabled = true;
  life.listen(next, "click", () => step(1));
  const search = document.createElement("input");
  search.type = "search";
  search.className = "kit-bar-field";
  search.tabIndex = -1;
  search.placeholder = t("media.pdf.search");
  search.setAttribute("aria-label", t("media.pdf.search_label"));
  life.listen(search, "change", () => {
    if (!engine || destroyed) return;
    const needle = search.value;
    void engine.search(needle, 20).then((hits) => {
      if (destroyed) return;
      say(
        hits.length === 0
          ? t("media.pdf.no_matches", { needle })
          : t("media.pdf.matches", { count: hits.length, page: hits[0]!.page }),
      );
    }).catch((error) => {
      if (!destroyed) say(t("media.pdf.search_failed", { reason: errorText(error) }));
    });
  });
  // La ricerca: il campo con la lente dentro.
  const searchBox = document.createElement("span");
  searchBox.className = "media-pdf-search";
  const lens = iconEl("search");
  if (lens) searchBox.append(lens);
  searchBox.append(search);
  // Il sommario, se il PDF ne ha uno: un elenco che porta alla pagina.
  const contents = document.createElement("select");
  contents.className = "media-pdf-outline kit-bar-field";
  contents.tabIndex = -1;
  contents.setAttribute("aria-label", t("media.pdf.outline"));
  contents.hidden = true;
  life.listen(contents, "change", () => {
    const target = Number(contents.value);
    contents.selectedIndex = 0;
    if (Number.isInteger(target) && target > 0) void show(target).catch(showFailed);
  });
  const fitButton = figure("media-fit-width", "media.pdf.fit_width", false);
  life.listen(fitButton, "click", () => {
    fit = !fit;
    fitButton.setAttribute("aria-pressed", String(fit));
    void show(page).catch(showFailed);
  });
  const spreadButton = figure("media-two-pages", "media.pdf.two_pages", false);
  life.listen(spreadButton, "click", () => {
    spread = !spread;
    spreadButton.setAttribute("aria-pressed", String(spread));
    void show(page).catch(showFailed);
  });
  // I colori del tema scuro: la pagina si inverte, e il giro di tinta riporta
  // i colori al loro tono (il rosso resta rosso, su fondo scuro).
  const darkButton = figure("media-dark-pages", "media.pdf.dark", false);
  life.listen(darkButton, "click", () => {
    dark = !dark;
    darkButton.setAttribute("aria-pressed", String(dark));
    for (const target of [canvas, facing, ...thumbs.querySelectorAll("canvas")]) target.style.filter = dark ? DARK_FILTER : "";
  });
  const thumbsButton = figure("media-thumbnails", "media.pdf.thumbnails", false);
  life.listen(thumbsButton, "click", () => {
    const open = thumbs.hidden;
    thumbs.hidden = !open;
    thumbsButton.setAttribute("aria-pressed", String(open));
    // Il piano si stringe: la pagina adattata la segue dal `ResizeObserver`.
    if (open && engine) buildThumbs(engine);
  });
  // «Mostra le annotazioni»: c'è soltanto con delle annotazioni che si
  // leggono, ed è acceso a ogni apertura.
  const marksButton = figure("media-show-annotations", "media.pdf.annotations", true);
  marksButton.hidden = true;
  life.listen(marksButton, "click", () => {
    marksShown = !marksShown;
    marksButton.setAttribute("aria-pressed", String(marksShown));
    void drawMarks();
  });
  // Il foglietto delle miniature c'è quando il motore le sa fare.
  const thumbsSheet = sheet(thumbsButton);
  thumbsSheet.hidden = true;

  /// Precedente e successiva si spengono ai capi; senza una pagina davanti
  /// (in caricamento, un PDF che non si apre) tutte e due. Il fuoco che stava
  /// su una delle due quando si spegne passa alla barra, non al documento.
  /// Finché nessuno è entrato nella barra il Tab la apre dalle pagine, non
  /// dal controllo che era il primo acceso durante il caricamento.
  function markSteps(): void {
    const focused = document.activeElement;
    const last = where ? (where.last ?? where.first) : 0;
    prev.disabled = !where || where.first <= 1;
    next.disabled = !where || last >= where.count;
    const current = keys.refresh(entered ? undefined : [prev, next].find((step) => !step.disabled) ?? null);
    const lost = focused === prev ? prev.disabled : focused === next ? next.disabled : false;
    if (lost && current) keys.focus(current);
  }

  let observer: IntersectionObserver | null = null;
  life.add(() => observer?.disconnect());
  let painting: Promise<void> = Promise.resolve();

  /// Le miniature si fanno una volta, al primo «Miniature»; si disegnano una
  /// alla volta, perché non tolgano tempo alla pagina.
  function buildThumbs(loaded: PdfEngine): void {
    if (thumbs.childElementCount > 0 || !loaded.renderThumbnail) return;
    const draw = (index: number, target: HTMLCanvasElement) => {
      painting = painting
        .then(() => (destroyed || engine !== loaded ? undefined : loaded.renderThumbnail!(index, target, PDF_THUMB_WIDTH)))
        // Una miniatura che non si disegna resta un foglio bianco col numero.
        .catch(() => {});
    };
    const count = Math.min(loaded.pageCount, PDF_THUMB_LIMIT);
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          const index = Number((entry.target as HTMLElement).dataset.page) - 1;
          const target = entry.target.querySelector("canvas");
          if (target) draw(index, target);
        }
      }, { root: thumbs, rootMargin: "200px 0px" });
    }
    for (let index = 0; index < count; index++) {
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.page = String(index + 1);
      item.setAttribute("aria-label", t("media.pdf.page_number", { page: index + 1 }));
      const sheet = document.createElement("canvas");
      if (dark) sheet.style.filter = DARK_FILTER;
      const label = document.createElement("span");
      label.textContent = String(index + 1);
      label.setAttribute("aria-hidden", "true");
      item.append(sheet, label);
      life.listen(item, "click", () => void show(index + 1).catch(showFailed));
      thumbs.append(item);
      if (observer) observer.observe(item);
      else if (index < PDF_THUMB_EAGER) draw(index, sheet);
    }
    markThumbs(page, spread && page < loaded.pageCount ? page + 1 : null);
  }

  /// La miniatura della pagina davanti (e della sua compagna) si segna, e si
  /// porta in vista.
  function markThumbs(first: number, second: number | null): void {
    for (const item of thumbs.children) {
      const n = Number((item as HTMLElement).dataset.page);
      if (n === first || n === second) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
    if (!thumbs.hidden) thumbs.children[first - 1]?.scrollIntoView?.({ block: "nearest" });
  }
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
  toolbar.append(sheet(prev, next), thumbsSheet, contents, searchBox, sheet(fitButton, spreadButton, darkButton));
  // Il foglietto di «Annota», con prima di lui l'interruttore delle
  // annotazioni; senza «Annota» l'interruttore sta da solo.
  const marksSheet = sheet(marksButton);
  if (options.onAnnotate) {
    const annotate = document.createElement("button");
    annotate.type = "button";
    annotate.className = "media-pdf-annotate kit-bar-button";
    annotate.tabIndex = -1;
    annotate.textContent = t("media.pdf.annotate");
    life.listen(annotate, "click", () => invokeAction(() => options.onAnnotate?.()));
    marksSheet.append(annotate);
  } else {
    marksSheet.hidden = true;
  }
  toolbar.append(marksSheet);
  // «…»: aprire con un'altra app e copiare il link alla pagina, i gesti che
  // non si fanno ogni volta. Senza nessuno dei due, «…» non c'è.
  const extra: { readonly label: Key; readonly run: () => void | Promise<void> }[] = [];
  if (options.onOpenExternal) extra.push({ label: "media.open_external", run: () => options.onOpenExternal?.() });
  if (options.onCopyLink) extra.push({ label: "media.pdf.copy_link", run: () => options.onCopyLink?.(page) });
  if (extra.length > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "kit-options-more";
    more.tabIndex = -1;
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-label", t("media.pdf.more"));
    const dots = iconEl("more");
    if (dots) more.append(dots);
    else more.textContent = "…";
    life.add(attachTooltip(more, t("media.pdf.more")));
    life.listen(more, "click", () => {
      const box = more.getBoundingClientRect();
      const items: MenuItem[] = extra.map((entry) => ({ label: t(entry.label), run: () => invokeAction(entry.run) }));
      more.setAttribute("aria-expanded", "true");
      showContextMenu(new MouseEvent("click", { clientX: box.left, clientY: box.bottom }), items, {
        onClose: () => more.setAttribute("aria-expanded", "false"),
      });
    });
    toolbar.append(more);
  }
  // Le frecce di ogni barra in una fila: un solo punto di Tab, e contano i
  // controlli visibili e accesi (il sommario c'è solo con un sommario).
  const keys = rovingToolbar(toolbar, {
    controls: () => [...toolbar.querySelectorAll<HTMLElement>("button, select, input")],
  }, life);
  keys.refresh();
  let entered = false;
  life.listen(toolbar, "focusin", () => {
    entered = true;
  });

  if (!options.loader) {
    resolveCount(null);
    fallback(t("media.pdf.no_engine"));
  } else if (bytes.byteLength === 0) {
    resolveCount(null);
    fallback(t("media.pdf.empty", { id: descriptor.id }));
  } else {
    say(t("media.loading", { id: descriptor.id }));
    void options
      .loader(bytes)
      .then((loaded) => {
        if (destroyed) {
          loaded.destroy();
          return;
        }
        engine = loaded;
        resolveCount(loaded.pageCount > 0 ? loaded.pageCount : null);
        if (engine.pageCount === 0) {
          fallback(`PDF ${descriptor.id} has no pages.`);
          return;
        }
        void show(page).catch(() => fallback(`PDF ${descriptor.id} failed to render page ${page}.`));
        void showOutline(loaded);
        thumbsSheet.hidden = !loaded.renderThumbnail;
      })
      .catch((error) => {
        resolveCount(null);
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
    keys.refresh();
  }

  /// Il posto di una pagina: il canvas e sopra, quando serve, lo strato
  /// delle annotazioni, un `<img>` grande quanto il canvas che i clic
  /// attraversano.
  function pageSheet(target: HTMLCanvasElement): PageSheet {
    const box = document.createElement("span");
    box.className = "media-pdf-sheet";
    box.append(target);
    return { box, mark: null, url: null, drawn: null, page: null };
  }

  /// Mette sul posto `sheet` lo strato `svg` della pagina `number`, o lo
  /// toglie. Il documento diventa un blob: in un `<img>` script e risorse
  /// esterne non partono. Il blob di prima si revoca.
  function drawMark(sheet: PageSheet, svg: string | null, number: number | null): void {
    sheet.page = number;
    if (svg === sheet.drawn) return;
    sheet.drawn = svg;
    if (sheet.url !== null) URL.revokeObjectURL(sheet.url);
    sheet.url = null;
    if (svg === null) {
      sheet.mark?.remove();
      sheet.mark = null;
      return;
    }
    if (sheet.mark === null) {
      const mark = document.createElement("img");
      mark.className = "media-pdf-annotations";
      mark.alt = "";
      mark.setAttribute("aria-hidden", "true");
      mark.decoding = "async";
      mark.draggable = false;
      sheet.mark = mark;
      sheet.box.append(mark);
    }
    sheet.url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    sheet.mark.src = sheet.url;
  }

  function setAnnotations(next: PdfAnnotationLayers | null, text: string | null): void {
    if (destroyed) return;
    layers = next;
    marksButton.hidden = next === null;
    marksSheet.hidden = next === null && !options.onAnnotate;
    marksNote.textContent = text ?? "";
    marksNote.hidden = !text;
    const focused = document.activeElement === marksButton;
    const current = keys.refresh();
    if (focused && marksButton.hidden && current) keys.focus(current);
    void drawMarks();
  }

  life.add(() => {
    destroyed = true;
    marking++;
    resolveCount(null);
    for (const sheet of [front, back]) drawMark(sheet, null, null);
    engine?.destroy();
    engine = null;
    root.remove();
  });

  return {
    element: root,
    page: () => page,
    where: () => where,
    goToPage: (n: number) => show(n),
    search: async (needle: string) => (engine && !destroyed ? engine.search(needle, 20) : []),
    pageCount: () => counted,
    setAnnotations,
    destroy: () => life.close(),
  };
}
