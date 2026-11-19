// La sezione Contenuto sulla resa per la stampa (E28, T74; il prototipo
// `pxFlow`, passo 29).
//
// La resa si monta una volta; prima di ogni misura `ExportContent` la cambia
// secondo le scelte del profilo, poi la misura, e dopo la misura (all'altra
// scelta, alla nota riletta) la rimette com'era (`ContentChanges`). Ogni
// specie di blocco ha il suo modulo:
//
// - `properties.ts`: le proprietà sotto il titolo;
// - `tasks.ts`: i compiti fatti tolti;
// - `folds.ts`: i ripiegabili aperti o chiusi;
// - `transclusions.ts`: la provenienza delle note riportate;
// - `bases.ts`: le Basi distese, misurate come tabelle;
// - `cards.ts`: le schede vive (anteprima, nome, pagine del PDF in coda);
// - `code.ts`: le righe del codice numerate;
// - `comments.ts`: i numeri dei commenti e le loro note;
// - `look.ts`: link e tabelle, che cambiano solo l'aspetto.
//
// La misura che torna è quella di sempre (`PrintMeasure`, o quella del
// libro), con tre aggiunte: ogni blocco tiene l'identità che aveva prima dei
// cambi (un blocco aggiunto non sposta i numeri degli altri: i blocchi
// lasciati fuori si ritrovano), porta le note dei suoi commenti, e una
// tabella lunga senza «ripeti l'intestazione» ha la riga d'intestazione
// dentro la prima riga, così non si ripete.
//
// Proprietà, pagine dei PDF e Basi arrivano dopo la resa: quando ci sono,
// `onChange` chiede di misurare da capo.

import type { MarginNote } from "../paginate/model";
import { blockId, printBlocks, type MeasureDepth, type MeasuredBlock } from "../paginate/measure";
import { frameOf, type BlockSource, type PrintLayout } from "../paginate/slices";
import { notePlacement } from "../paginate/rules";
import { MM } from "../profile";
import { applyBases, basesPending } from "./bases";
import { applyCards, type CardPages } from "./cards";
import { ContentChanges } from "./changes";
import { applyCodeNumbers } from "./code";
import { markComments, noteElement, notesHeading, NOTE_TRIM_MM, type CommentThread, type NotesShape } from "./comments";
import { applyFolds } from "./folds";
import { applyProperties, shownProperties, type NoteProperty } from "./properties";
import { applyTasks } from "./tasks";
import { applyTransclusions } from "./transclusions";

/// Ciò che il contenuto chiede fuori dalla resa.
export interface ContentPorts {
  /// Le proprietà della nota, dall'indice; senza, nessuna proprietà.
  readonly properties?: () => Promise<readonly NoteProperty[]>;
  /// Le pagine di un PDF incorporato, disegnate larghe `width` pixel; `null`
  /// se il PDF non si legge. Senza, il PDF esce con la sua anteprima.
  readonly cardPages?: (target: string, width: number) => Promise<CardPages | null>;
}

export interface ExportContentOptions extends ContentPorts {
  /// Il nome della nota: `![[#Sezione]]` riporta una sezione sua.
  readonly title: string;
  /// Qualcosa è arrivato (le proprietà, le pagine di un PDF, una Base):
  /// misurare da capo.
  readonly onChange: () => void;
  /// Ogni quanto si guarda se una Base ha la sua tabella, e per quanto.
  readonly basePollMs?: number;
  readonly basePollLimit?: number;
}

/// Il prefisso delle identità dei blocchi che il contenuto aggiunge.
export const ADDED_PREFIX = "contenuto:";

/// Dove vanno le note di questa impaginazione, o `null` senza note.
export function notesShapeOf(layout: PrintLayout): NotesShape | null {
  const comments = layout.content?.comments ?? "no";
  if (comments === "no") return null;
  return notePlacement(frameOf(layout).frame) === "margine" ? "margine" : "fondo";
}

/// La larghezza di una nota: nel margine quanto il margine meno lo spazio
/// attorno; in fondo quanto la colonna.
export function noteWidth(layout: PrintLayout, shape: NotesShape): number {
  if (shape === "fondo") return frameOf(layout).width;
  return Math.max(24, layout.page.margin.right - NOTE_TRIM_MM * MM);
}

export class ExportContent {
  private changes = new ContentChanges();
  private notes: HTMLElement | null = null;
  private properties: readonly NoteProperty[] | null = null;
  private propertiesAsked = false;
  private readonly cardPages = new Map<string, CardPages | null>();
  private readonly cardAsked = new Set<string>();
  private baseTimer = 0;
  private disposed = false;
  private generation = 0;

  constructor(private readonly options: ExportContentOptions) {}

  /// La nota è stata riletta: proprietà e PDF si richiedono.
  refresh(): void {
    this.generation++;
    this.properties = null;
    this.propertiesAsked = false;
    this.cardPages.clear();
    this.cardAsked.clear();
  }

  /// Cambia la resa `page` per `layout`, la misura con `build` e torna la
  /// misura; il suo `dispose` rimette la resa com'era.
  measure(page: HTMLElement, host: HTMLElement, layout: PrintLayout, build: (page: HTMLElement) => BlockSource & { dispose?(): void }): BlockSource & { dispose(): void } {
    this.undo();
    const content = layout.content;
    if (!content) return withDispose(build(page), () => {});
    // Le identità di prima dei cambi: un blocco aggiunto non sposta le altre.
    const before = new Map<HTMLElement, string>();
    printBlocks(page).forEach((element, index) => before.set(element, blockId(element, index)));
    const changes = this.changes;
    // L'ordine conta: ciò che si toglie prima, così i commenti di un
    // compito tolto non hanno un numero, e il codice si numera per ultimo
    // sulla resa già disposta.
    applyTasks(page, content.doneTasks, changes);
    applyFolds(page, content.folds, changes);
    if (content.properties !== "nessuna") {
      const loaded = this.loadProperties();
      if (loaded) applyProperties(page, shownProperties(loaded, content.properties), changes);
    }
    applyTransclusions(page, this.options.title, changes);
    const bases = applyBases(page, changes);
    if (bases.pending) this.watchBases(page);
    const { width, frame } = frameOf(layout);
    const cards = applyCards(page, content.cards, this.cardPages, { width, height: frame.height }, changes);
    for (const target of cards.wanted) this.loadCard(target, width);
    applyCodeNumbers(page, content.codeNumbers, changes);
    const shape = notesShapeOf(layout);
    const threads = shape ? markComments(page, changes) : [];
    const notes = shape && threads.length > 0 ? this.mountNotes(host, threads, shape, noteWidth(layout, shape)) : new Map<string, HTMLElement>();
    const inner = build(page);
    const blocks = printBlocks(page);
    const marks = new Map<HTMLElement, CommentThread[]>();
    for (const thread of threads) {
      const block = blocks.find((element) => element.contains(thread.mark));
      if (!block) continue;
      marks.set(block, [...(marks.get(block) ?? []), thread]);
    }
    let added = 0;
    const ids = new Map<number, string>();
    const idOf = (index: number, given: string): string => {
      if (!given.startsWith("blocco:")) return given;
      const known = ids.get(index);
      if (known) return known;
      const element = blocks[index];
      const id = (element && before.get(element)) ?? `${ADDED_PREFIX}${added++}`;
      ids.set(index, id);
      return id;
    };
    return {
      get count() {
        return inner.count;
      },
      measure: (index: number, depth: MeasureDepth): MeasuredBlock => {
        const measured = inner.measure(index, depth);
        const element = blocks[index];
        let box = { ...measured.box, id: idOf(index, measured.box.id) } as MeasuredBlock["box"];
        if (box.kind === "table" && !content.repeatHeader && box.header > 0 && box.rows.length > 0) {
          box = { ...box, header: 0, rows: [box.header + box.rows[0]!, ...box.rows.slice(1)] };
        }
        const own = element ? marks.get(element) : undefined;
        if (own && own.length > 0) {
          const top = element!.getBoundingClientRect().top;
          const list: MarginNote[] = own.map((thread) => ({
            id: thread.id,
            height: notes.get(thread.id)?.getBoundingClientRect().height ?? 0,
            at: Math.max(0, thread.mark.getBoundingClientRect().top - top),
          }));
          box = { ...box, notes: list };
        }
        return { ...measured, box };
      },
      dispose: () => {
        inner.dispose?.();
        this.undo();
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    window.clearTimeout(this.baseTimer);
    this.undo();
  }

  private undo(): void {
    this.changes.undo();
    this.notes?.remove();
    this.notes = null;
  }

  /// Le note, larghe come usciranno, in un contenitore accanto alla resa:
  /// fuori dalla pagina di stampa, così non sono blocchi.
  private mountNotes(host: HTMLElement, threads: readonly CommentThread[], shape: NotesShape, width: number): Map<string, HTMLElement> {
    const box = document.createElement("div");
    box.className = "export-comments";
    box.dataset["shape"] = shape;
    box.style.width = `${width}px`;
    const lang = document.documentElement.lang || "";
    const out = new Map<string, HTMLElement>();
    threads.forEach((thread, index) => {
      const note = noteElement(thread, shape, lang);
      if (shape === "fondo" && index === 0) note.prepend(notesHeading());
      box.append(note);
      out.set(thread.id, note);
    });
    host.append(box);
    this.notes = box;
    return out;
  }

  private loadProperties(): readonly NoteProperty[] | null {
    if (this.properties) return this.properties;
    const port = this.options.properties;
    if (!port || this.propertiesAsked) return null;
    this.propertiesAsked = true;
    const generation = this.generation;
    void port().then(
      (entries) => {
        if (this.disposed || generation !== this.generation) return;
        this.properties = entries;
        if (entries.length > 0) this.options.onChange();
      },
      () => {
        // Senza l'indice la pagina esce senza proprietà, come «Nessuna».
        if (generation === this.generation) this.properties = [];
      },
    );
    return null;
  }

  private loadCard(target: string, width: number): void {
    const port = this.options.cardPages;
    if (!port) {
      this.cardPages.set(target, null);
      return;
    }
    if (this.cardAsked.has(target)) return;
    this.cardAsked.add(target);
    const generation = this.generation;
    void port(target, width).then(
      (pages) => {
        if (this.disposed || generation !== this.generation) return;
        this.cardPages.set(target, pages);
        if (pages && pages.canvases.length > 0) this.options.onChange();
      },
      () => {
        if (generation === this.generation) this.cardPages.set(target, null);
      },
    );
  }

  /// Una Base che non ha ancora disegnato: si guarda ogni tanto, e quando ha
  /// la sua vista si misura da capo.
  private watchBases(page: HTMLElement): void {
    window.clearTimeout(this.baseTimer);
    const every = this.options.basePollMs ?? 250;
    let left = this.options.basePollLimit ?? 60;
    const generation = this.generation;
    const check = () => {
      if (this.disposed || generation !== this.generation || !page.isConnected) return;
      if (!basesPending(page)) {
        this.options.onChange();
        return;
      }
      if (--left > 0) this.baseTimer = window.setTimeout(check, every);
    };
    this.baseTimer = window.setTimeout(check, every);
  }
}

function withDispose(source: BlockSource & { dispose?(): void }, after: () => void): BlockSource & { dispose(): void } {
  return {
    get count() {
      return source.count;
    },
    measure: (index, depth) => source.measure(index, depth),
    dispose: () => {
      source.dispose?.();
      after();
    },
  };
}
