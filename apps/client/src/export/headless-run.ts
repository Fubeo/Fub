// L'esportazione chiesta da fuori, la parte che lavora (T79): salva la nota,
// la impagina fuori dallo schermo con gli stessi pezzi dello spazio
// «Esporta in PDF», misura i fogli e manda l'elenco a `pdf.write_pages`. Si
// carica alla prima richiesta (`loadRun` in `headless.ts`): all'avvio resta
// fuori dal pacchetto della shell.

import type { CommandOutcome } from "../host/contract";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import type { PrintRenderer } from "../editors/media/print-view";
import type { PdfPagesPorts } from "./content/pdf-pages";
import type { TocHeading } from "./paginate/toc";
import type { BlockSource, PrintLayout, PrintSettings, Scheduler, SlicedResult } from "./paginate/slices";
import { measureSheets, type ProbeFace, type ProbeItem, type ProbeOptions } from "./probe";
import type { ExportProfile } from "./profile";
import type { CoverFacts } from "./sections/cover-toc";
import type { VaultFontSource } from "./sections/fonts";
import type { ExportMount } from "./space";
import type { DiagramMemory } from "./vectors";
import { WRITE_COMMAND, type ExportRequest, type HeadlessDeps } from "./headless";

/// Il livello più profondo di un segnalibro (`MAX_LIVELLO_SEGNALIBRO`).
const MAX_BOOKMARK_LEVEL = 6;

/// L'id del lavoro che `pdf.write_pages` ha accodato.
function queuedJobOf(outcome: CommandOutcome): string | null {
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== "fub.pdf.queued") return null;
  const id = (effect.payload as { job_id?: unknown } | null)?.job_id;
  return typeof id === "string" ? id : null;
}

/// Esegue una richiesta: salva, impagina fuori dallo schermo, misura e manda
/// l'elenco al core. Ogni errore diventa un avviso che dice quale nota.
export async function exportRequested(request: ExportRequest, deps: HeadlessDeps): Promise<void> {
  const title = deps.title(request.note);
  deps.notify(t("pdf_export.headless.started", { doc: title }), "info");
  let laid: OffscreenPages | null = null;
  try {
    // Prima di tutto la nota sul disco: le modifiche non salvate entrano.
    await deps.save(request.note);
    const pipeline = await loadPipeline();
    const profile = pipeline.profileFromCore(request.profile) ?? pipeline.defaultProfile();
    const properties = deps.properties ? await deps.properties(request.note).catch(() => []) : [];
    laid = await paginateOffscreen({
      doc: request.note,
      title,
      profile,
      render: deps.render,
      mount: deps.mount ? await deps.mount(request.note) : undefined,
      properties,
      vaultFonts: deps.vaultFonts,
      pdf: deps.pdf,
      parent: deps.parent,
      scheduler: deps.scheduler,
      waitMs: deps.waitMs,
      measure: deps.measure,
    }, pipeline);
    const memory = laid.memory;
    const list = pageListOf(laid.sheets, laid.layout.page, { title, bookmarks: profile.frontespizio.segnalibri ? laid.bookmarks : [] }, {
      vectorOf: (img) => pipeline.vectorOf(img, memory),
      fontFaces: [...(deps.fontFaces?.() ?? []), ...laid.fontFaces],
    }, deps.measureSheets);
    const { uscita } = profile;
    const outcome = await deps.invoke(WRITE_COMMAND, {
      pages: JSON.stringify(list),
      target: request.target,
      replace: request.replace,
      note: request.note,
      images: uscita.immagini === "alleggerite" ? "light" : "full",
      accessible: uscita.accessibile,
      pdfa: uscita.pdfa,
    }, "apply");
    const job = queuedJobOf(outcome);
    if (job !== null) deps.queued?.(job, request);
  } catch (error) {
    deps.notify(t("pdf_export.headless.failed", { doc: title, reason: errorText(error) }), "guasto");
  } finally {
    laid?.dispose();
  }
}

// ── I pezzi dell'impaginazione, caricati alla prima richiesta ───────────────

async function importPipeline() {
  const [pages, decor, measure, slices, profile, cover, header, page, fonts, content, comments, bases, pdfPages, themes, vectors] = await Promise.all([
    import("./pages"),
    import("./decor"),
    import("./paginate/measure"),
    import("./paginate/slices"),
    import("./profile"),
    import("./sections/cover-toc"),
    import("./sections/header-footer"),
    import("./sections/page"),
    import("./sections/fonts"),
    import("./content/index"),
    import("./content/comments"),
    import("./content/bases"),
    import("./content/pdf-pages"),
    import("./themes"),
    import("./vectors"),
  ]);
  return {
    ExportPages: pages.ExportPages,
    decorOf: decor.decorOf,
    tocMeasurer: decor.tocMeasurer,
    PrintMeasure: measure.PrintMeasure,
    PrintPaginator: slices.PrintPaginator,
    defaultProfile: profile.defaultProfile,
    printSettingsOf: profile.printSettingsOf,
    profileFromCore: profile.profileFromCore,
    coverFactsOf: cover.coverFactsOf,
    displayPath: header.displayPath,
    longDate: header.longDate,
    pageMarksOf: page.pageMarksOf,
    PrintFonts: fonts.PrintFonts,
    ExportContent: content.ExportContent,
    inertComments: comments.inertComments,
    basesPending: bases.basesPending,
    renderPdfPages: pdfPages.renderPdfPages,
    numberHeadings: themes.numberHeadings,
    DiagramMemory: vectors.DiagramMemory,
    diagramPrintLook: vectors.diagramPrintLook,
    overrideFor: vectors.overrideFor,
    preparePrintVectors: vectors.preparePrintVectors,
    vectorOf: vectors.vectorOf,
  };
}

/// I pezzi dell'impaginazione fuori dallo schermo.
export type Pipeline = Awaited<ReturnType<typeof importPipeline>>;

let pipelineLoad: Promise<Pipeline> | null = null;

/// Carica (una volta) i pezzi dell'impaginazione; un caricamento fallito si
/// riprova alla richiesta dopo.
export function loadPipeline(): Promise<Pipeline> {
  pipelineLoad ??= importPipeline().catch((error: unknown) => {
    pipelineLoad = null;
    throw error;
  });
  return pipelineLoad;
}

// ── Fuori dallo schermo ─────────────────────────────────────────────────────

export interface OffscreenOptions {
  readonly doc: string;
  readonly title: string;
  readonly profile: ExportProfile;
  readonly render: PrintRenderer;
  readonly mount?: ExportMount;
  readonly properties?: readonly { readonly key: string; readonly value: unknown }[];
  readonly vaultFonts?: VaultFontSource;
  readonly pdf?: PdfPagesPorts;
  /// Per quanto si aspetta al più una Base che non ha ancora disegnato.
  readonly settleLimitMs?: number;
  readonly parent?: HTMLElement;
  readonly scheduler?: Scheduler;
  readonly waitMs?: number;
  readonly measure?: (page: HTMLElement) => BlockSource & { dispose?(): void };
}

/// Un segnalibro del PDF: un titolo, il suo livello, la sua pagina e dove
/// comincia sulla pagina (`Segnalibro`).
export interface Bookmark {
  readonly titolo: string;
  readonly livello: number;
  readonly pagina: number;
  readonly y: number;
}

export interface OffscreenPages {
  /// I fogli come escono, frontespizio e indice compresi, montati fuori
  /// dallo schermo coi colori del tema di stampa.
  readonly sheets: readonly HTMLElement[];
  readonly layout: PrintLayout;
  readonly bookmarks: readonly Bookmark[];
  /// I disegni dei diagrammi, per passarli come vettori.
  readonly memory: DiagramMemory;
  /// Le regole `@font-face` dei caratteri del vault caricati per i fogli.
  readonly fontFaces: readonly string[];
  dispose(): void;
}

/// Per quanto si aspetta al più una Base che non ha ancora disegnato: poi i
/// fogli escono come sono, come allo spazio.
const SETTLE_LIMIT_MS = 15_000;

/// Impagina la nota fuori dallo schermo col profilo, fino all'impaginazione
/// finale, e torna i fogli pronti da misurare. È ciò che fa lo spazio, senza
/// lo spazio: nessun fuoco si sposta e niente si vede, il palco sta fuori
/// dalla finestra, inerte.
export async function paginateOffscreen(options: OffscreenOptions, pipeline?: Pipeline): Promise<OffscreenPages> {
  const p = pipeline ?? (await loadPipeline());
  const profile = options.profile;
  // I caratteri del vault che il profilo nomina, prima di misurare: lo
  // spazio rifà le pagine quando arrivano, qui si aspettano.
  const fonts = new p.PrintFonts(options.vaultFonts ?? null);
  await fonts.ensure(profile);
  const settings: PrintSettings = p.printSettingsOf(profile);
  const memory = new p.DiagramMemory();
  const look = p.diagramPrintLook(profile);
  const parent = options.parent ?? document.body;
  const facts = p.coverFactsOf(options.properties ?? []);
  const cover: CoverFacts = { title: options.title, path: p.displayPath(options.doc), author: facts.author, date: p.longDate(), icon: facts.icon, properties: facts.properties };

  const stage = document.createElement("div");
  stage.className = "export-headless";
  stage.setAttribute("aria-hidden", "true");
  stage.inert = true;
  // Fuori dalla finestra ma disposto: la misura legge ciò che il browser
  // disegna, e un palco nascosto non disegnerebbe niente.
  Object.assign(stage.style, { position: "fixed", left: "-100000px", top: "0", width: "1200px", height: "800px", overflow: "hidden", pointerEvents: "none" });
  parent.append(stage);

  const pages = new p.ExportPages({ stage, onVisible: () => {}, onPick: () => {} });
  pages.setColors({ ...settings.layout.type, ...settings.look.colors });
  pages.setMarks(p.pageMarksOf(profile));
  // I fogli da misurare, uno sotto l'altro, nello stesso contenitore delle
  // pagine: ne prendono le variabili dei caratteri e dei colori.
  const sheetsHost = document.createElement("div");
  pages.element.append(sheetsHost);
  const measureToc = p.tocMeasurer(pages, () => settings.layout);

  let paginator: InstanceType<Pipeline["PrintPaginator"]> | null = null;
  let done = false;
  let settleTimer = 0;
  let settle: () => void = () => {};

  // Il Contenuto (T74) chiede fuori dalla resa le proprietà e le pagine dei
  // PDF incorporati, e aspetta le Basi: quando arriva qualcosa si misura da
  // capo. I fogli escono solo da un'impaginazione finale senza niente in
  // arrivo dopo di lei.
  let inFlight = 0;
  let wanted = 0;
  let measuredAt = -1;
  let lastFinal: SlicedResult | null = null;
  const track = <T,>(work: Promise<T>): Promise<T> => {
    inFlight++;
    return work.finally(() => {
      inFlight--;
      // Arrivato senza niente da rimisurare (nessuna proprietà, un PDF che
      // non si legge): l'ultima impaginazione finale vale. Dopo il `then`
      // del Contenuto, che può chiedere di rimisurare.
      window.setTimeout(() => settle(), 0);
    });
  };
  const content = new p.ExportContent({
    title: options.title,
    properties: () => track(Promise.resolve(options.properties ?? [])),
    cardPages: options.pdf ? (target, width) => track(p.renderPdfPages(options.pdf!, target, options.doc, width)) : undefined,
    onChange: () => {
      if (done || !paginator) return;
      wanted++;
      void paginator.remeasure();
    },
  });

  const dispose = () => {
    if (done) return;
    done = true;
    window.clearTimeout(settleTimer);
    paginator?.dispose();
    paginator = null;
    content.dispose();
    pages.dispose();
    memory.dispose();
    fonts.dispose();
    stage.remove();
  };

  const exportMount = options.mount;
  return new Promise<OffscreenPages>((resolve, reject) => {
    const started = Date.now();
    const limit = options.settleLimitMs ?? SETTLE_LIMIT_MS;
    settle = () => {
      const result = lastFinal;
      if (done || !paginator || !result) return;
      if (inFlight > 0 || measuredAt !== wanted) return;
      const host = paginator.host;
      const left = limit - (Date.now() - started);
      if (left > 0 && p.basesPending(host)) {
        // Il Contenuto guarda le Basi e misura da capo quando disegnano; se
        // non disegnano entro il limite, i fogli escono come sono.
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => settle(), left);
        return;
      }
      lastFinal = null;
      window.clearTimeout(settleTimer);
      try {
        const { decor, headings } = p.decorOf({ result, host, profile, layout: settings.layout, cover, measureToc });
        pages.show(result, host, settings.layout, decor);
        const sheets = pages.printable();
        sheetsHost.replaceChildren(...sheets);
        const bookmarks = bookmarksOf(result, headings, decor.front, settings.layout.page.margin.top);
        // Il paginatore ha finito: i fogli restano, la resa misurata no.
        resolve({ sheets, layout: settings.layout, bookmarks, memory, fontFaces: fonts.fontFaces(), dispose });
      } catch (error) {
        dispose();
        reject(error);
      }
    };
    paginator = new p.PrintPaginator({
      doc: options.doc,
      title: options.title,
      // I commenti della resa diventano segnaposti, come allo spazio
      // (`inertComments`): senza, la scelta «Commenti» non avrebbe niente.
      render: async (doc, target) => {
        const rendered = await options.render(doc, target);
        return { ...rendered, html: p.inertComments(rendered.html) };
      },
      mount: exportMount && ((container, rendered) => exportMount(container, rendered, { diagramLook: (index) => p.overrideFor(look, index) })),
      prepare: (page) => p.preparePrintVectors(page, memory),
      settings,
      scheduler: options.scheduler,
      waitMs: options.waitMs,
      parent,
      // Come allo spazio: i titoli prendono il numero, poi il Contenuto
      // cambia la resa secondo le scelte (T74) e la misura.
      measure: (page) => {
        p.numberHeadings(page);
        measuredAt = wanted;
        return content.measure(page, paginator!.host, settings.layout, (shaped) => (options.measure ? options.measure(shaped) : new p.PrintMeasure(shaped)));
      },
      onUpdate: (result) => {
        if (done || !paginator) return;
        // Tutte le pagine contano: nessuna è «lontana dalla vista».
        paginator.setVisible({ first: 0, last: Math.max(0, result.pagination.pages.length - 1) });
        if (!result.final) return;
        lastFinal = result;
        settle();
      },
      onError: (error) => {
        if (done) return;
        dispose();
        reject(error);
      },
    });
    void paginator.open();
  });
}

/// I segnalibri dai titoli della nota: la pagina del PDF (frontespizio e
/// indice compresi) e dove comincia il titolo sulla pagina.
function bookmarksOf(result: SlicedResult, headings: readonly TocHeading[], front: number, top: number): Bookmark[] {
  const out: Bookmark[] = [];
  for (const heading of headings) {
    const text = heading.text.trim();
    if (!text) continue;
    const page = result.pagination.pages.findIndex((candidate) => candidate.placements.some((placement) => placement.box === heading.box && placement.part === "corpo" && !placement.continued));
    if (page < 0) continue;
    const placement = result.pagination.pages[page]?.placements.find((candidate) => candidate.box === heading.box);
    const titolo = heading.number ? `${heading.number} ${text}` : text;
    out.push({ titolo, livello: Math.min(Math.max(1, heading.level), MAX_BOOKMARK_LEVEL), pagina: front + page, y: Math.round((placement?.y ?? 0) + top) });
  }
  return out;
}

// ── L'elenco delle pagine ───────────────────────────────────────────────────

/// L'elenco delle pagine del core (`ElencoPagine`, versione 1).
export interface PageListOut {
  readonly versione: 1;
  readonly larghezza: number;
  readonly altezza: number;
  readonly titolo: string;
  readonly autore: string;
  readonly lingua: string;
  readonly facce: ProbeFace[];
  readonly pagine: { pezzi: ProbeItem[] }[];
  readonly segnalibri: readonly Bookmark[];
}

/// Dai fogli impaginati (uno per pagina, montati e disposti) all'elenco che
/// `pdf.write_pages` scrive. Autore e lingua li legge il core dalla nota.
export function pageListOf(
  sheets: readonly HTMLElement[],
  page: PrintLayout["page"],
  meta: { readonly title: string; readonly bookmarks?: readonly Bookmark[] },
  options: ProbeOptions = {},
  measure: typeof measureSheets = measureSheets,
): PageListOut {
  const measured = measure(sheets, options);
  const count = measured.pagine.length;
  return {
    versione: 1,
    larghezza: page.width,
    altezza: page.height,
    titolo: meta.title,
    autore: "",
    lingua: "",
    facce: measured.facce,
    pagine: measured.pagine,
    segnalibri: (meta.bookmarks ?? []).filter((bookmark) => bookmark.pagina < count),
  };
}
