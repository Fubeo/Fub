// L'impaginatore sulla vista, a fette (E28, T69b).
//
// La resa per la stampa si chiede al core una volta, all'apertura
// (`PrintPaginator`); la vista la monta fuori dallo schermo, larga quanto la
// colonna del testo, ne misura i blocchi (`measure.ts`) e li passa alle regole
// (`rules.ts`). Una nota lunga non si misura in un colpo solo:
//
// 1. si stimano i blocchi dall'inizio finché le stime coprono le pagine che si
//    vedono (un rettangolo per blocco: le righe uguali, dall'interlinea);
// 2. si misurano riga per riga i blocchi di quelle pagine, e le pagine escono;
// 3. il resto, prima le stime e poi le righe, si fa nei tempi morti, a fette
//    di pochi millisecondi. Finché non ha finito, il totale delle pagine è
//    «…» (`total` null) e l'indice aspetta i suoi numeri (`firstPage` null).
//
// Stima e righe danno la stessa altezza a ogni blocco: con le righe vere una
// pagina si sposta al più di una riga, e chi la guarda la vede aggiornata.
//
// Due velocità: i colori e i link cambiano solo variabili CSS sul contenitore
// (`PrintLook`), senza impaginare di nuovo; caratteri, margini, formato e
// contenuto (`PrintLayout`) rifanno misura e impaginazione, non la resa.
// Una nota cambiata in un altro riquadro (`reload`) chiede la resa nuova e
// tiene le regolazioni; una resa vecchia che arriva dopo la nuova si scarta.

import type { RenderedDocument } from "../../host/contract";
import { PRINT_WAIT_MS, mountPrintSurface, type PrintMount, type PrintRenderer, type PrintSurface } from "../../editors/media/print-view";
import type { PageGeometry } from "../probe";
import { applyBreaks, type BreakSettings } from "./breaks";
import { blockId, PrintMeasure, printBlocks, type MeasureDepth, type MeasuredBlock } from "./measure";
import type { Box, PageFrame, Pagination, Placement } from "./model";
import { paginate, rulesOf } from "./rules";

/// Chi misura i blocchi: `PrintMeasure` sulla resa vera, un finto nei test.
export interface BlockSource {
  readonly count: number;
  measure(index: number, depth: MeasureDepth): MeasuredBlock;
}

/// Quando gira la fetta dopo. `soon` lascia disegnare e riparte (le pagine
/// che si vedono); `idle` aspetta i tempi morti (il resto).
export interface Scheduler {
  now(): number;
  soon(task: () => void): () => void;
  idle(task: () => void): () => void;
}

/// Il calendario del browser: `requestIdleCallback` dove c'è, se no un
/// `setTimeout` (WebKit non sempre lo ha).
export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  soon(task) {
    const timer = window.setTimeout(task, 0);
    return () => window.clearTimeout(timer);
  },
  idle(task) {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => task(), { timeout: 200 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(task, 16);
    return () => window.clearTimeout(timer);
  },
};

/// Quanto lavora una fetta mentre mancano le pagine che si vedono: sotto i
/// 50 ms di un compito lungo, perché la finestra risponda lo stesso.
export const VISIBLE_SLICE_MS = 40;
/// Quanto lavora una fetta nei tempi morti.
export const IDLE_SLICE_MS = 8;

/// Le pagine che si vedono, da `first` a `last` comprese.
export interface VisiblePages {
  readonly first: number;
  readonly last: number;
}

/// Ciò che l'impaginatore dà a chi mostra le pagine.
export interface SlicedResult {
  readonly pagination: Pagination;
  /// Le scatole impaginate, con le interruzioni: `Placement.box` è un indice
  /// qui dentro.
  readonly boxes: readonly Box[];
  /// Per ogni scatola, il blocco della resa (`-1` per un'interruzione).
  readonly blocks: readonly number[];
  /// Per ogni scatola, il suo bordo alto nella resa (`NaN` per
  /// un'interruzione): chi disegna sposta il blocco da lì (`pageShift`).
  readonly tops: readonly number[];
  /// Le pagine pronte dall'inizio: da 0 a `ready` escluso.
  readonly ready: number;
  /// Tutto misurato riga per riga: le pagine non cambiano più.
  readonly final: boolean;
  /// Il numero delle pagine, quando è sicuro; se no `null` («…»).
  readonly total: number | null;
  /// La pagina di ogni scatola, per l'indice: solo a lavoro finito.
  readonly firstPage: readonly number[] | null;
  /// Quanto è costata finora l'impaginazione, in millisecondi di lavoro.
  readonly workMs: number;
}

/// Dove va disegnato ciò che nella resa sta all'altezza `y` del blocco della
/// fascia: `y` della pagina = `(y − from) · scale + offset`. Restituisce
/// `offset` e `scale`, per una traslazione e una scala.
export function pageShift(result: Pick<SlicedResult, "tops">, placement: Placement): { readonly offset: number; readonly scale: number } {
  const top = result.tops[placement.box] ?? 0;
  return { offset: placement.y - (top + placement.from) * placement.scale, scale: placement.scale };
}

interface Built {
  readonly boxes: Box[];
  readonly blocks: number[];
  readonly tops: number[];
}

/// Ciò che serve a `SlicedPagination`.
export interface SlicedOptions {
  readonly source: BlockSource;
  readonly frame: PageFrame;
  readonly breaks: BreakSettings;
  readonly onUpdate: (result: SlicedResult) => void;
  /// Una misura che fallisce (un blocco tolto da sotto): l'impaginazione si
  /// ferma e lo dice.
  readonly onError?: (error: unknown) => void;
  readonly scheduler?: Scheduler;
}

interface LayoutState {
  readonly pagination: Pagination;
  readonly built: Built;
  readonly ready: number;
}

/// L'impaginazione a fette di una resa già montata. `onUpdate` riceve le
/// pagine quando quelle che si vedono sono pronte o cambiano, quando il conto
/// delle pagine è completo e alla fine.
export class SlicedPagination {
  private readonly source: BlockSource;
  private readonly frame: PageFrame;
  private readonly scheduler: Scheduler;
  private readonly measured: (MeasuredBlock | undefined)[];
  private readonly exact: boolean[];
  /// I blocchi stimati, dall'inizio.
  private estimated = 0;
  /// Il primo blocco che potrebbe non essere misurato riga per riga.
  private fineCursor = 0;
  private visible: VisiblePages = { first: 0, last: 0 };
  /// Le pagine che si vedono sono coperte dalle stime e misurate riga per riga.
  private visibleDone = false;
  /// Il fondo della resa stimata oltre il quale riprovare se le stime coprono
  /// le pagine che si vedono: impaginare costa più che sommare.
  private nextCheck = 0;
  private cancel: (() => void) | null = null;
  private stopped = false;
  private done = false;
  private workMs = 0;
  private lastVisibleKey = "";
  private lastPublished: SlicedResult | null = null;
  private countPublished = false;
  /// Il blocco più in basso sulle pagine che si vedono, all'ultima
  /// impaginazione: le righe vere dei blocchi oltre non le spostano.
  private visibleReach = -1;
  /// L'ultima impaginazione, finché nessuna misura cambia.
  private cached: LayoutState | null = null;

  constructor(private readonly options: SlicedOptions) {
    this.source = options.source;
    this.frame = options.frame;
    this.scheduler = options.scheduler ?? browserScheduler;
    this.measured = new Array<MeasuredBlock | undefined>(this.source.count);
    this.exact = new Array<boolean>(this.source.count).fill(false);
  }

  get finished(): boolean {
    return this.done;
  }

  get result(): SlicedResult | null {
    return this.lastPublished;
  }

  start(visible: VisiblePages = this.visible): void {
    this.visible = normalize(visible);
    this.schedule("soon");
  }

  /// Le pagine che si vedono sono cambiate: se non sono pronte, passano
  /// davanti al resto. A lavoro finito sono tutte pronte.
  setVisible(visible: VisiblePages): void {
    const next = normalize(visible);
    if (next.first === this.visible.first && next.last === this.visible.last) return;
    this.visible = next;
    if (this.done || this.stopped) return;
    this.visibleDone = false;
    this.nextCheck = 0;
    this.lastVisibleKey = "";
    this.schedule("soon");
  }

  stop(): void {
    this.stopped = true;
    this.cancel?.();
    this.cancel = null;
  }

  private schedule(kind: "soon" | "idle"): void {
    if (this.stopped || this.done) return;
    this.cancel?.();
    this.cancel = this.scheduler[kind](() => {
      this.cancel = null;
      if (this.stopped) return;
      try {
        if (this.visibleDone) this.sliceRest();
        else this.sliceVisible();
      } catch (error) {
        this.stop();
        this.options.onError?.(error);
      }
    });
  }

  /// Una fetta per le pagine che si vedono: le stime fino a coprirle, poi le
  /// righe dei loro blocchi. Escono appena sono pronte.
  private sliceVisible(): void {
    const { scheduler } = this;
    const started = scheduler.now();
    const deadline = started + VISIBLE_SLICE_MS;
    let covered = this.coversVisible();
    while (!covered && scheduler.now() < deadline) {
      this.estimate(this.estimated);
      covered = this.coversVisible();
    }
    if (covered) {
      // Le righe vere possono portare un blocco in più sulle pagine che si
      // vedono: si rifà finché non ce ne sono (al più quattro giri).
      for (let round = 0; round < 4 && scheduler.now() < deadline; round++) {
        const pending = this.pendingVisible();
        if (pending.length === 0) break;
        for (const index of pending) this.fine(index);
      }
      this.visibleDone = this.pendingVisible().length === 0;
    }
    this.workMs += scheduler.now() - started;
    if (!this.visibleDone) {
      this.schedule("soon");
      return;
    }
    if (this.allExact()) {
      this.done = true;
      this.publish(true);
      return;
    }
    this.publish(false);
    this.schedule("idle");
  }

  /// Una fetta nei tempi morti: le stime che mancano, poi le righe di tutto,
  /// dall'inizio.
  private sliceRest(): void {
    const { scheduler } = this;
    const started = scheduler.now();
    const deadline = started + IDLE_SLICE_MS;
    const n = this.source.count;
    let touched = false;
    let countReady = false;
    do {
      if (this.estimated < n) {
        this.estimate(this.estimated);
        countReady ||= this.estimated === n;
        continue;
      }
      if (this.allExact()) {
        this.done = true;
        break;
      }
      if (this.fineCursor <= this.visibleReach) touched = true;
      this.fine(this.fineCursor);
    } while (scheduler.now() < deadline);
    this.workMs += scheduler.now() - started;
    if (this.done) {
      this.publish(true);
      return;
    }
    if (touched || (countReady && !this.countPublished)) this.publish(false);
    this.schedule("idle");
  }

  private estimate(index: number): void {
    const block = this.source.measure(index, "stima");
    this.measured[index] = block;
    this.exact[index] = block.exact;
    this.estimated = index + 1;
    this.cached = null;
  }

  private fine(index: number): void {
    this.measured[index] = this.source.measure(index, "righe");
    this.exact[index] = true;
    this.cached = null;
  }

  /// Tutto stimato e tutto misurato riga per riga.
  private allExact(): boolean {
    if (this.estimated < this.source.count) return false;
    while (this.fineCursor < this.source.count && this.exact[this.fineCursor]) this.fineCursor++;
    return this.fineCursor >= this.source.count;
  }

  private layout(): LayoutState {
    if (this.cached) return this.cached;
    const built = this.build(this.estimated);
    const pagination = paginate(built.boxes, this.frame);
    const ready = this.estimated === this.source.count ? pagination.pages.length : this.readyPages(built, pagination);
    this.cached = { pagination, built, ready };
    let reach = -1;
    for (const page of this.visiblePages(pagination)) {
      for (const placement of page.placements) if (placement.box >= 0) reach = Math.max(reach, built.blocks[placement.box]);
    }
    this.visibleReach = reach;
    return this.cached;
  }

  private visiblePages(pagination: Pagination): readonly Pagination["pages"][number][] {
    return pagination.pages.slice(this.visible.first, this.visible.last + 1);
  }

  /// Le stime arrivano oltre l'ultima pagina che si vede (o alla fine).
  private coversVisible(): boolean {
    if (this.estimated >= this.source.count) return true;
    const last = this.measured[this.estimated - 1];
    const perPage = this.frame.height * this.frame.columns;
    if (!last || last.bottom < Math.max(this.nextCheck, perPage * (this.visible.last + 1.5))) return false;
    if (this.layout().ready > this.visible.last) return true;
    this.nextCheck = last.bottom + this.frame.height / 2;
    return false;
  }

  /// I blocchi delle pagine che si vedono non ancora misurati riga per riga.
  private pendingVisible(): number[] {
    const { pagination, built } = this.layout();
    const pending = new Set<number>();
    for (const page of this.visiblePages(pagination)) {
      for (const placement of page.placements) {
        const block = placement.box >= 0 ? built.blocks[placement.box] : -1;
        if (block >= 0 && !this.exact[block]) pending.add(block);
      }
    }
    return [...pending];
  }

  /// Le pagine sicure di un pezzo della nota: tutte meno l'ultima, che il
  /// seguito può ancora riempire, e meno quelle di una fila di titoli in
  /// fondo, che col blocco dopo può voltare pagina.
  private readyPages(built: Built, pagination: Pagination): number {
    let ready = pagination.pages.length - 1;
    let k = built.boxes.length - 1;
    while (k >= 0 && built.boxes[k].kind === "break") k--;
    let start = -1;
    while (k >= 0) {
      const box = built.boxes[k];
      if (box.kind === "break" || !rulesOf(box, this.frame.height).keepWithNext) break;
      start = k--;
    }
    if (start >= 0 && pagination.firstPage[start] >= 0) ready = Math.min(ready, pagination.firstPage[start]);
    return Math.max(0, ready);
  }

  /// Le scatole dei primi `count` blocchi, con lo spazio fra uno e l'altro e
  /// le interruzioni scelte.
  private build(count: number): Built {
    const boxes: Box[] = [];
    const blocks: number[] = [];
    const tops: number[] = [];
    let bottom = Number.NaN;
    for (let i = 0; i < count; i++) {
      const block = this.measured[i];
      if (!block) continue;
      const gap = Number.isNaN(bottom) ? 0 : Math.max(0, block.top - bottom);
      bottom = block.bottom;
      for (const box of applyBreaks([{ ...block.box, gap }], this.options.breaks)) {
        boxes.push(box);
        blocks.push(box.kind === "break" ? -1 : i);
        tops.push(box.kind === "break" ? Number.NaN : block.top);
      }
    }
    return { boxes, blocks, tops };
  }

  private publish(final: boolean): void {
    const { pagination, built, ready } = this.layout();
    const visibleKey = this.visibleKey(pagination);
    const count = this.estimated === this.source.count;
    if (!final && visibleKey === this.lastVisibleKey && (!count || this.countPublished)) return;
    this.lastVisibleKey = visibleKey;
    if (count) this.countPublished = true;
    const result: SlicedResult = {
      pagination,
      boxes: built.boxes,
      blocks: built.blocks,
      tops: built.tops,
      ready: final ? pagination.pages.length : ready,
      final,
      total: final ? pagination.pages.length : null,
      firstPage: final ? pagination.firstPage : null,
      workMs: this.workMs,
    };
    this.lastPublished = result;
    this.options.onUpdate(result);
  }

  private visibleKey(pagination: Pagination): string {
    const pages = pagination.pages.slice(this.visible.first, this.visible.last + 1);
    return JSON.stringify(pages.map((page) => page.placements.map((p) => [p.box, p.part, p.from, p.to, p.y, p.column, p.scale])));
  }
}

function normalize(visible: VisiblePages): VisiblePages {
  const first = Math.max(0, Math.floor(visible.first));
  return { first, last: Math.max(first, Math.floor(visible.last)) };
}

// --- L'impaginatore della nota: la resa, le regolazioni, le revisioni ---

/// Ciò che cambia le misure e rifà l'impaginazione.
export interface PrintLayout {
  /// Il formato e i margini, in pixel CSS.
  readonly page: PageGeometry;
  readonly columns: 1 | 2;
  /// Lo spazio fra le due colonne, in pixel CSS.
  readonly columnGap: number;
  readonly breaks: BreakSettings;
  /// Le variabili CSS che cambiano le misure: caratteri, corpo, interlinea.
  readonly type: Readonly<Record<string, string>>;
  /// I blocchi lasciati fuori (le identità di `blockId`).
  readonly excluded: readonly string[];
}

/// Ciò che cambia solo l'aspetto: variabili CSS di colori e link.
export interface PrintLook {
  readonly colors: Readonly<Record<string, string>>;
}

export interface PrintSettings {
  readonly layout: PrintLayout;
  readonly look: PrintLook;
}

/// Il cambio di regolazioni rifà l'impaginazione: solo se cambia qualcosa
/// che cambia le misure.
export function layoutChanged(before: PrintLayout, after: PrintLayout): boolean {
  return JSON.stringify(canonical(before)) !== JSON.stringify(canonical(after));
}

function canonical(layout: PrintLayout): unknown {
  return {
    page: layout.page,
    columns: layout.columns,
    columnGap: layout.columns === 2 ? layout.columnGap : 0,
    breaks: { everyHeading2: layout.breaks.everyHeading2, separator: layout.breaks.separator },
    type: Object.entries(layout.type).sort(([a], [b]) => a.localeCompare(b)),
    excluded: [...layout.excluded].sort(),
  };
}

/// La colonna del testo e la pagina vista dalle regole.
export function frameOf(layout: PrintLayout): { readonly width: number; readonly frame: PageFrame } {
  const { page, columns } = layout;
  const inner = page.width - page.margin.left - page.margin.right;
  const gap = columns === 2 ? Math.max(0, layout.columnGap) : 0;
  const width = (inner - gap) / columns;
  const height = page.height - page.margin.top - page.margin.bottom;
  if (!(width > 0) || !(height > 0)) throw new RangeError(`i margini non lasciano spazio sulla pagina (${Math.round(width)}×${Math.round(height)} px)`);
  return { width, frame: { height, columns, noteMargin: page.margin.right } };
}

export interface PrintPaginatorOptions {
  readonly doc: string;
  readonly title: string;
  readonly render: PrintRenderer;
  readonly mount?: PrintMount;
  readonly settings: PrintSettings;
  readonly onUpdate: (result: SlicedResult) => void;
  readonly onError?: (error: unknown) => void;
  readonly scheduler?: Scheduler;
  /// Dove sta il contenitore fuori dallo schermo: di serie `document.body`.
  readonly parent?: HTMLElement;
  /// Quanto si aspettano diagrammi e immagini: di serie `PRINT_WAIT_MS`.
  readonly waitMs?: number;
  /// Chi misura la resa montata: di serie `PrintMeasure` (i test ne danno uno
  /// finto, happy-dom non dispone).
  readonly measure?: (page: HTMLElement) => BlockSource & { dispose?(): void };
}

/// L'impaginatore di una nota per l'esportazione: chiede la resa per la
/// stampa, la monta fuori dallo schermo e la impagina a fette. Le regolazioni
/// si cambiano con `update`, la nota cambiata si segue con `reload`.
export class PrintPaginator {
  /// Il contenitore della resa: largo quanto la colonna, fuori dallo
  /// schermo. Chi disegna le pagine ne copia o ne sposta i blocchi.
  readonly host: HTMLElement;
  private settings: PrintSettings;
  private visible: VisiblePages = { first: 0, last: 0 };
  private generation = 0;
  private surface: PrintSurface | null = null;
  private source: (BlockSource & { dispose?(): void }) | null = null;
  private slices: SlicedPagination | null = null;
  private hidden: HTMLElement[] = [];
  private appliedType: string[] = [];
  private appliedColors: string[] = [];
  private disposed = false;
  /// Quante volte la resa è stata misurata e impaginata da capo.
  layouts = 0;
  /// Quante volte la resa è stata chiesta al core.
  renders = 0;

  constructor(private readonly options: PrintPaginatorOptions) {
    this.settings = options.settings;
    this.host = document.createElement("div");
    this.host.className = "export-measure";
    this.host.setAttribute("aria-hidden", "true");
    this.host.inert = true;
    Object.assign(this.host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      visibility: "hidden",
      pointerEvents: "none",
      zIndex: "-1",
    });
    (options.parent ?? document.body).append(this.host);
    this.applyLook(this.settings.look);
  }

  /// Chiede la resa al core e comincia. La chiamata dopo una revisione nuova
  /// della nota è `reload`.
  open(): Promise<void> {
    return this.load();
  }

  /// La nota è cambiata (in un altro riquadro, o salvata): la resa nuova, le
  /// stesse regolazioni e le stesse pagine sotto gli occhi.
  reload(): Promise<void> {
    return this.load();
  }

  update(settings: PrintSettings): void {
    const relayout = layoutChanged(this.settings.layout, settings.layout);
    this.settings = settings;
    this.applyLook(settings.look);
    if (relayout && this.surface) this.relayout();
  }

  setVisible(visible: VisiblePages): void {
    this.visible = normalize(visible);
    this.slices?.setVisible(this.visible);
  }

  get result(): SlicedResult | null {
    return this.slices?.result ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.stopSlices();
    this.surface?.dispose();
    this.surface = null;
    this.host.remove();
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    let rendered: RenderedDocument;
    try {
      this.renders++;
      rendered = await this.options.render(this.options.doc, "print");
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.options.onError?.(error);
      return;
    }
    // Una revisione più nuova è già stata chiesta: questa resa è vecchia.
    if (generation !== this.generation || this.disposed) return;
    this.stopSlices();
    this.surface?.dispose();
    this.hidden = [];
    let surface: PrintSurface;
    try {
      surface = mountPrintSurface(this.host, {
        title: this.options.title,
        rendered,
        mount: this.options.mount,
        limit: this.options.waitMs ?? PRINT_WAIT_MS,
      });
    } catch (error) {
      this.surface = null;
      this.options.onError?.(error);
      return;
    }
    this.surface = surface;
    await surface.settled;
    if (generation !== this.generation || this.disposed) return;
    this.relayout();
  }

  /// Misura e impagina da capo la resa montata, con le regolazioni di ora.
  private relayout(): void {
    const surface = this.surface;
    if (!surface) return;
    this.stopSlices();
    const { layout } = this.settings;
    let shape: ReturnType<typeof frameOf>;
    try {
      shape = frameOf(layout);
    } catch (error) {
      this.options.onError?.(error);
      return;
    }
    this.host.style.width = `${shape.width}px`;
    this.appliedType = applyVariables(this.host, layout.type, this.appliedType);
    this.applyExcluded(surface.page, layout.excluded);
    this.layouts++;
    const source = (this.options.measure ?? ((page) => new PrintMeasure(page)))(surface.page);
    this.source = source;
    this.slices = new SlicedPagination({
      source,
      frame: shape.frame,
      breaks: layout.breaks,
      onUpdate: (result) => {
        if (!this.disposed) this.options.onUpdate(result);
      },
      onError: (error) => {
        if (!this.disposed) this.options.onError?.(error);
      },
      scheduler: this.options.scheduler,
    });
    this.slices.start(this.visible);
  }

  private stopSlices(): void {
    this.slices?.stop();
    this.slices = null;
    this.source?.dispose?.();
    this.source = null;
  }

  private applyLook(look: PrintLook): void {
    this.appliedColors = applyVariables(this.host, look.colors, this.appliedColors);
  }

  /// I blocchi lasciati fuori non si dispongono: spariscono dalla resa, e il
  /// blocco dopo sale al loro posto.
  private applyExcluded(page: HTMLElement, excluded: readonly string[]): void {
    for (const element of this.hidden) element.hidden = false;
    this.hidden = [];
    if (excluded.length === 0) return;
    const out = new Set(excluded);
    printBlocks(page).forEach((element, index) => {
      if (!out.has(blockId(element, index))) return;
      element.hidden = true;
      this.hidden.push(element);
    });
  }
}

/// Scrive le variabili CSS sul contenitore e toglie quelle di prima che non
/// ci sono più. Solo proprietà personalizzate (`--…`): le regolazioni non
/// scrivono CSS qualunque.
function applyVariables(host: HTMLElement, values: Readonly<Record<string, string>>, before: readonly string[]): string[] {
  const names = Object.keys(values);
  for (const name of names) if (!/^--[a-z0-9-]+$/iu.test(name)) throw new RangeError(`«${name}» non è una variabile CSS`);
  for (const name of before) if (!(name in values)) host.style.removeProperty(name);
  for (const name of names) host.style.setProperty(name, values[name]);
  return names;
}
