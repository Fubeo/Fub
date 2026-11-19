// L'esportazione chiesta da fuori (E28, T79): un agente, via MCP, chiede il
// PDF di una nota col comando `pdf.export_note`, e il core lo manda qui, come
// evento, perché il core da solo non impagina (ADR 0247: la vista impagina e
// misura, il core scrive).
//
// Finché è aperta, la shell rinnova la sua presenza (`pdf.export_listen`):
// senza di lei il comando risponde che serve l'app aperta. Per ogni richiesta
// la shell salva la nota se ha modifiche, la impagina fuori dallo schermo con
// gli stessi pezzi dello spazio «Esporta in PDF» (l'impaginatore della stampa,
// i fogli con testata, frontespizio e indice), misura ciò che il browser ha
// disegnato su ogni foglio (`pageListOf`) e lo manda a `pdf.write_pages`, che
// accoda il lavoro del core.
//
// `pageListOf` è la strada che lo spazio potrà usare per «Esporta»: dai fogli
// impaginati all'elenco delle pagine del core.
//
// Il modulo si carica all'avvio, per la presenza: l'impaginazione e i suoi
// pezzi (la resa per la stampa, i fogli, i diagrammi) si caricano solo alla
// prima richiesta (`loadPipeline`), come lo spazio.

import type { CommandOutcome, InvokeMode } from "../host/contract";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import type { PrintRenderer } from "../editors/media/print-view";
import type { PageDecor } from "./pages";
import type { TocEntry, TocHeading, TocMetrics } from "./paginate/toc";
import type { BlockSource, PrintLayout, PrintSettings, Scheduler, SlicedResult } from "./paginate/slices";
import { measureSheets, type ProbeFace, type ProbeItem, type ProbeOptions } from "./probe";
import type { ExportProfile } from "./profile";
import type { CoverFacts } from "./sections/cover-toc";
import type { ExportMount } from "./space";
import type { DiagramMemory } from "./vectors";

/// La shell dice al core che c'è e sa impaginare.
export const LISTEN_COMMAND = "pdf.export_listen";
/// Il comando che accoda la scrittura del PDF.
export const WRITE_COMMAND = "pdf.write_pages";
/// L'evento con cui il core chiede un'esportazione (`TOPIC_RICHIESTA`).
export const REQUEST_TOPIC = "fub.draw:pdf.export";
/// Ogni quanto si rinnova la presenza, se il core non dice altro: la promessa
/// vale due minuti (`TTL_PRESENZA_MS`), il rinnovo è largo.
export const RENEW_MS = 30_000;
/// Quante richieste aspettano al più: le altre si rifiutano, con un avviso.
export const QUEUE_LIMIT = 8;
/// Il livello più profondo di un segnalibro (`MAX_LIVELLO_SEGNALIBRO`).
const MAX_BOOKMARK_LEVEL = 6;

/// Una richiesta del core, come arriva nell'evento. Il profilo è quello del
/// file, intero: lo completa la vista quando lo usa (`profileFromCore`).
export interface ExportRequest {
  readonly request: string;
  readonly note: string;
  readonly target: string;
  readonly replace: boolean;
  readonly profileId: string;
  readonly profile: unknown;
}

/// La richiesta dal payload dell'evento, o `null` se non lo è: il payload
/// viene dal core, ma la shell non si fida della forma.
export function parseRequest(payload: unknown): ExportRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const request = text(p["request"]);
  const note = text(p["note"]);
  const target = text(p["target"]);
  if (!request || !note || !target) return null;
  return { request, note, target, replace: p["replace"] === true, profileId: text(p["profile_id"]) ?? "", profile: p["profile"] ?? null };
}

/// Chi aiuta l'esportazione fuori dallo schermo: la stessa resa, lo stesso
/// montaggio e lo stesso salvataggio dello spazio.
export interface HeadlessDeps {
  readonly render: PrintRenderer;
  /// Chi monta la resa della nota (le forme che dichiara si leggono prima).
  readonly mount?: (doc: string) => Promise<ExportMount>;
  /// Salva la nota, se ha modifiche: il core la rende dal disco.
  readonly save: (doc: string) => Promise<void>;
  readonly properties?: (doc: string) => Promise<readonly { readonly key: string; readonly value: unknown }[]>;
  readonly title: (doc: string) => string;
  readonly invoke: (command: string, args: Record<string, unknown>, mode: InvokeMode) => Promise<CommandOutcome>;
  /// Si iscrive agli eventi `custom` del core; torna lo smontaggio.
  readonly listen: (handler: (topic: string, payload: unknown) => void) => () => void;
  readonly notify: (message: string, kind: "info" | "guasto") => void;
  /// Il lavoro accodato: la shell gli dà un nome nel centro attività.
  readonly queued?: (jobId: string, request: ExportRequest) => void;
  /// Il CSS delle regole `@font-face` del tema di adesso (vedi `ProbeOptions`).
  readonly fontFaces?: () => readonly string[];
  readonly parent?: HTMLElement;
  readonly scheduler?: Scheduler;
  readonly waitMs?: number;
  readonly measure?: (page: HTMLElement) => BlockSource & { dispose?(): void };
  /// Chi misura i fogli (i test ne danno uno finto: happy-dom non dispone).
  readonly measureSheets?: typeof measureSheets;
  readonly renewMs?: number;
  /// Se il core del vault aperto ha il comando della presenza (i disegni
  /// accesi): senza, la shell non lo chiama. Di serie sì.
  readonly available?: () => boolean;
  /// Avvisa quando l'elenco dei comandi cambia (un vault aperto, un
  /// componente acceso); torna lo smontaggio.
  readonly onAvailability?: (changed: () => void) => () => void;
}

/// Comincia ad ascoltare le richieste e a rinnovare la presenza; torna lo
/// smontaggio, che smette tutte e due e lascia scadere la presenza.
export function startHeadlessExport(deps: HeadlessDeps): () => void {
  let stopped = false;
  let pending = 0;
  let chain: Promise<void> = Promise.resolve();
  let timer = 0;

  const schedule = (ms: number) => {
    if (stopped) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(renew, ms);
  };
  function renew(): void {
    window.clearTimeout(timer);
    if (stopped || !(deps.available?.() ?? true)) return;
    deps.invoke(LISTEN_COMMAND, {}, "apply").then(
      (outcome) => schedule(renewOf(outcome) ?? deps.renewMs ?? RENEW_MS),
      // Un core senza il comando (i disegni spenti) o che non risponde: si
      // riprova al giro dopo, senza disturbare.
      () => schedule(deps.renewMs ?? RENEW_MS),
    );
  }

  const unlisten = deps.listen((topic, payload) => {
    if (stopped || topic !== REQUEST_TOPIC) return;
    const request = parseRequest(payload);
    if (!request) return;
    if (pending >= QUEUE_LIMIT) {
      deps.notify(t("pdf_export.headless.busy", { doc: deps.title(request.note) }), "guasto");
      return;
    }
    pending++;
    // Una alla volta: due impaginazioni insieme si contenderebbero la pagina.
    chain = chain.then(async () => {
      try {
        if (!stopped) await exportRequested(request, deps);
      } finally {
        pending--;
      }
    });
  });

  // Un vault nuovo ha un core suo: la presenza si dice subito a lui.
  const unwatch = deps.onAvailability?.(renew) ?? (() => {});
  renew();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    unwatch();
    unlisten();
  };
}

/// Ogni quanto il core vuole il rinnovo, dall'esito di `pdf.export_listen`.
function renewOf(outcome: CommandOutcome): number | null {
  const effect = outcome.effect;
  if (effect.kind !== "custom") return null;
  const every = (effect.payload as { renew_ms?: unknown } | null)?.renew_ms;
  return typeof every === "number" && every >= 1000 ? every : null;
}

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
      parent: deps.parent,
      scheduler: deps.scheduler,
      waitMs: deps.waitMs,
      measure: deps.measure,
    }, pipeline);
    const memory = laid.memory;
    const list = pageListOf(laid.sheets, laid.layout.page, { title, bookmarks: profile.frontespizio.segnalibri ? laid.bookmarks : [] }, {
      vectorOf: (img) => pipeline.vectorOf(img, memory),
      fontFaces: deps.fontFaces?.(),
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
  const [pages, measure, toc, slices, profile, cover, header, themes, vectors] = await Promise.all([
    import("./pages"),
    import("./paginate/measure"),
    import("./paginate/toc"),
    import("./paginate/slices"),
    import("./profile"),
    import("./sections/cover-toc"),
    import("./sections/header-footer"),
    import("./themes"),
    import("./vectors"),
  ]);
  return {
    ExportPages: pages.ExportPages,
    PrintMeasure: measure.PrintMeasure,
    printBlocks: measure.printBlocks,
    frontMatter: toc.frontMatter,
    headingsOf: toc.headingsOf,
    sectionHeadings: toc.sectionHeadings,
    sectionsByPage: toc.sectionsByPage,
    PrintPaginator: slices.PrintPaginator,
    defaultProfile: profile.defaultProfile,
    printSettingsOf: profile.printSettingsOf,
    profileFromCore: profile.profileFromCore,
    coverFactsOf: cover.coverFactsOf,
    drawCover: cover.drawCover,
    drawTocPage: cover.drawTocPage,
    displayPath: header.displayPath,
    drawHeaderFooter: header.drawHeaderFooter,
    longDate: header.longDate,
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
  dispose(): void;
}

/// Le misure dell'indice quando il foglio non si dispone (happy-dom).
const TOC_FALLBACK = { heading: 48, row: 22 };

/// Impagina la nota fuori dallo schermo col profilo, fino all'impaginazione
/// finale, e torna i fogli pronti da misurare. È ciò che fa lo spazio, senza
/// lo spazio: nessun fuoco si sposta e niente si vede, il palco sta fuori
/// dalla finestra, inerte.
export async function paginateOffscreen(options: OffscreenOptions, pipeline?: Pipeline): Promise<OffscreenPages> {
  const p = pipeline ?? (await loadPipeline());
  const profile = options.profile;
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
  // I fogli da misurare, uno sotto l'altro, nello stesso contenitore delle
  // pagine: ne prendono le variabili dei caratteri e dei colori.
  const sheetsHost = document.createElement("div");
  pages.element.append(sheetsHost);

  let tocMeasured: { key: string; metrics: TocMetrics } | null = null;
  const measureToc = (entries: readonly TocEntry[]): TocMetrics => {
    const { page } = settings.layout;
    const key = JSON.stringify([page, settings.layout.type, entries.map((entry) => [entry.level, entry.text, entry.number, entry.page])]);
    if (tocMeasured?.key === key) return tocMeasured.metrics;
    const metrics = pages.measureSheet(page, (body) => {
      const toc = p.drawTocPage(body, entries, true);
      const rows = [...toc.querySelectorAll<HTMLElement>(".export-toc-row")];
      const top = toc.getBoundingClientRect().top;
      const first = rows[0]?.getBoundingClientRect();
      const heights = rows.map((row) => row.getBoundingClientRect().height);
      if (!first || heights.every((height) => height === 0)) {
        return { page: body.clientHeight || page.height - page.margin.top - page.margin.bottom, heading: TOC_FALLBACK.heading, rows: rows.map(() => TOC_FALLBACK.row) };
      }
      return { page: page.height - page.margin.top - page.margin.bottom, heading: Math.max(0, first.top - top), rows: heights };
    });
    tocMeasured = { key, metrics };
    return metrics;
  };

  const decorOf = (result: SlicedResult, host: HTMLElement): { decor: PageDecor; bookmarks: Bookmark[] } => {
    const page = host.querySelector<HTMLElement>(".print-page");
    const blocks = page ? p.printBlocks(page) : [];
    const headings = p.headingsOf(result.boxes, (box) => {
      const block = blocks[result.blocks[box] ?? -1];
      return { text: block?.textContent ?? "", number: block?.dataset["printNumber"] ?? "" };
    });
    const front = p.frontMatter({
      settings: {
        cover: profile.frontespizio.frontespizio,
        toc: profile.frontespizio.indice,
        roman: profile.testata.numeri_romani,
        firstWithoutHeader: profile.testata.prima_pagina_senza,
        depth: profile.frontespizio.profondita_indice,
      },
      headings,
      flowPages: result.pagination.pages.length,
      final: result.final,
      firstPage: result.firstPage,
      measure: measureToc,
    });
    const sections = p.sectionsByPage(result.pagination.pages, p.sectionHeadings(headings));
    const geometry = settings.layout.page;
    const decor: PageDecor = {
      sheets: front.sheets,
      front: front.front,
      draw(sheetPage, body, sheet, ordinal) {
        if (sheet.kind === "frontespizio") p.drawCover(body, cover, geometry.margin);
        else if (sheet.kind === "indice") p.drawTocPage(body, front.toc[sheet.index] ?? [], sheet.index === 0);
        const section = sheet.kind === "pagina" ? (sections[sheet.index] ?? "") : "";
        p.drawHeaderFooter(sheetPage, geometry, profile.testata, cover, sheet, section, profile.pagina.specchio && ordinal % 2 === 1);
      },
    };
    return { decor, bookmarks: bookmarksOf(result, headings, front.front, geometry.margin.top) };
  };

  let paginator: InstanceType<Pipeline["PrintPaginator"]> | null = null;
  let done = false;
  const dispose = () => {
    if (done) return;
    done = true;
    paginator?.dispose();
    paginator = null;
    pages.dispose();
    memory.dispose();
    stage.remove();
  };

  const exportMount = options.mount;
  return new Promise<OffscreenPages>((resolve, reject) => {
    paginator = new p.PrintPaginator({
      doc: options.doc,
      title: options.title,
      render: options.render,
      mount: exportMount && ((container, rendered) => exportMount(container, rendered, { diagramLook: (index) => p.overrideFor(look, index) })),
      prepare: (page) => p.preparePrintVectors(page, memory),
      settings,
      scheduler: options.scheduler,
      waitMs: options.waitMs,
      parent,
      measure: (page) => {
        p.numberHeadings(page);
        return options.measure ? options.measure(page) : new p.PrintMeasure(page);
      },
      onUpdate: (result) => {
        if (done || !paginator) return;
        // Tutte le pagine contano: nessuna è «lontana dalla vista».
        paginator.setVisible({ first: 0, last: Math.max(0, result.pagination.pages.length - 1) });
        if (!result.final) return;
        try {
          const { decor, bookmarks } = decorOf(result, paginator.host);
          pages.show(result, paginator.host, settings.layout, decor);
          const sheets = pages.printable();
          sheetsHost.replaceChildren(...sheets);
          // Il paginatore ha finito: i fogli restano, la resa misurata no.
          resolve({ sheets, layout: settings.layout, bookmarks, memory, dispose });
        } catch (error) {
          dispose();
          reject(error);
        }
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
