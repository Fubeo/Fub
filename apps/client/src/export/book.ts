// Più note in un PDF (E28, T78): una cartella o una scelta di note nello
// spazio «Esporta in PDF», ogni nota un capitolo.
//
// Lo spazio impagina una resa sola (`PrintPaginator`): qui le note diventano
// quella resa. `createBook` dà allo spazio il suo `render`, il suo `mount` e
// il suo `measure`:
//
// - `render` chiede al core la resa per la stampa di ogni nota, nell'ordine
//   dato (quello dell'albero o della scelta). Una nota che non si legge si
//   salta, e `skipped` la nomina perché lo spazio lo dica; se non se ne legge
//   nessuna, l'errore è quello della prima;
// - `mount` monta i capitoli uno dopo l'altro: il titolo della nota, poi la
//   sua resa, montata come quella di una nota sola (i suoi media si cercano
//   accanto a lei). Prima di ogni capitolo dopo il primo c'è un segno che
//   l'impaginatore legge come un'interruzione di pagina «capitolo»
//   (`breaks.ts`): ogni nota comincia su una pagina sua;
// - i collegamenti fra le note del libro portano il capitolo a cui vanno
//   (`data-export-chapter`, e la sezione in `data-export-section`): chi scrive
//   il PDF ne fa collegamenti interni (`pdf.write_book`, i `rimandi`); quelli
//   verso note che il libro non ha restano come sono, verso fuori.
//
// L'indice è uno solo perché la resa è una: l'indice della sezione
// «Frontespizio e indice» conta le pagine di tutto il libro.

import type { RenderedDocument } from "../host/contract";
import type { PrintMount, PrintRenderer } from "../editors/media/print-view";
import { setSanitizedHtml } from "../ui/sanitize";
import { inertComments } from "./content/comments";
import { CHAPTER_BREAK_PREFIX } from "./paginate/breaks";
import { PrintMeasure, type MeasureDepth, type MeasuredBlock } from "./paginate/measure";
import type { BlockSource } from "./paginate/slices";

/// Quante note al più in un libro: oltre, la resa fuori schermo diventa troppo
/// pesante per una finestra che deve restare pronta. Il core ne accetta di più
/// (`MAX_CAPITOLI`): il tetto qui è della vista.
export const BOOK_LIMIT = 500;

/// Le estensioni delle note che lo spazio sa impaginare.
const MARKDOWN = /\.(md|markdown)$/iu;

/// Le note Markdown di un elenco, senza ripetizioni e nell'ordine dato; il
/// resto (disegni, fogli, file) a parte, perché chi esporta sappia che cosa
/// resta fuori.
export function bookNotes(paths: readonly string[]): { readonly notes: string[]; readonly others: string[] } {
  const seen = new Set<string>();
  const notes: string[] = [];
  const others: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    (MARKDOWN.test(path) ? notes : others).push(path);
  }
  return { notes, others };
}

/// Il nome di una nota: il file senza cartella né estensione.
export function noteName(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

function withoutExtension(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1 ? path.slice(0, dot) : path;
}

/// Un percorso relativo alla cartella di `from`, con `.` e `..` risolti.
/// `null` se esce dal vault.
export function relativeTo(from: string, path: string): string | null {
  const base = path.startsWith("/") ? [] : from.split("/").slice(0, -1);
  const parts = [...base];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/// Trova il capitolo di un collegamento: un wikilink nomina la nota col nome
/// (`[[Beta]]`) o col percorso senza estensione (`[[Progetto/Beta]]`), un
/// collegamento a un file col percorso relativo alla nota che lo contiene.
/// Un nome che due note del libro hanno uguale non si indovina: resta verso
/// fuori.
export class ChapterTargets {
  private readonly byPath = new Map<string, number>();
  private readonly byName = new Map<string, number | null>();

  constructor(docs: readonly string[]) {
    docs.forEach((doc, index) => {
      this.byPath.set(doc.toLowerCase(), index);
      this.byPath.set(withoutExtension(doc).toLowerCase(), index);
      const name = noteName(doc).toLowerCase();
      this.byName.set(name, this.byName.has(name) ? null : index);
    });
  }

  /// Il capitolo di `[[page]]`, o `null`.
  wiki(page: string): number | null {
    const key = page.trim().replace(/^\/+/u, "").toLowerCase();
    if (key === "") return null;
    return this.byPath.get(key) ?? (key.includes("/") ? null : this.byName.get(key) ?? null);
  }

  /// Il capitolo di un collegamento a un file scritto nella nota `from`.
  path(from: string, path: string): number | null {
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // Un `%` che non codifica niente: il percorso resta com'è scritto.
    }
    const [file] = decoded.split("#");
    const resolved = relativeTo(from, file ?? "");
    return resolved === null ? null : this.byPath.get(resolved.toLowerCase()) ?? null;
  }
}

/// Segna i collegamenti di un capitolo che portano a una nota del libro.
export function markChapterLinks(root: ParentNode, from: string, targets: ChapterTargets): number {
  let marked = 0;
  for (const link of root.querySelectorAll<HTMLAnchorElement>("a.wikilink[data-wikilink-page], a.internal-path[data-path]")) {
    const wiki = link.dataset["wikilinkPage"];
    const chapter = wiki !== undefined ? targets.wiki(wiki) : targets.path(from, link.dataset["path"] ?? "");
    if (chapter === null) continue;
    link.dataset["exportChapter"] = String(chapter);
    const section = link.dataset["wikilinkHeading"] ?? link.dataset["path"]?.split("#")[1];
    if (section) link.dataset["exportSection"] = section;
    marked++;
  }
  return marked;
}

/// Monta la resa di una nota in un contenitore: quella dello spazio di una
/// nota sola, con la nota per i suoi media.
export type ChapterMount = (container: HTMLElement, rendered: RenderedDocument, doc: string) => {
  readonly ready: Promise<void>;
  dispose(): void;
};

export interface BookOptions {
  /// Le note, già in ordine.
  readonly docs: readonly string[];
  readonly render: PrintRenderer;
  readonly mount?: ChapterMount;
  /// Il titolo di un capitolo: di serie il nome della nota.
  readonly title?: (doc: string) => string;
}

export interface Book {
  readonly render: PrintRenderer;
  readonly mount: PrintMount;
  readonly measure: (page: HTMLElement) => BlockSource & { dispose?(): void };
  /// Le note dell'ultima resa che non si sono lette.
  skipped(): readonly string[];
  /// Le note dell'ultima resa, nell'ordine dei capitoli.
  chapters(): readonly string[];
}

/// La resa vuota che `render` dà allo spazio: i capitoli veri li tiene il
/// libro, e li monta `mount`.
const EMPTY: RenderedDocument = { html: "", parts: [] };

export function createBook(options: BookOptions): Book {
  const title = options.title ?? noteName;
  let rendered: { doc: string; rendered: RenderedDocument }[] = [];
  let skipped: string[] = [];

  const render: PrintRenderer = async (_doc, target) => {
    const read: { doc: string; rendered: RenderedDocument }[] = [];
    const missed: string[] = [];
    let first: unknown = null;
    // Una alla volta: cento note in parallelo terrebbero il core occupato
    // tutto insieme, e chi guarda aspetterebbe lo stesso l'ultima.
    for (const doc of options.docs) {
      try {
        // I commenti passano il sanificatore come segnaposti (T74).
        const chapter = await options.render(doc, target);
        read.push({ doc, rendered: { ...chapter, html: inertComments(chapter.html) } });
      } catch (error) {
        first ??= error;
        missed.push(doc);
      }
    }
    if (read.length === 0) throw first ?? new Error("nessuna nota");
    rendered = read;
    skipped = missed;
    return EMPTY;
  };

  const mount: PrintMount = (container) => {
    const targets = new ChapterTargets(rendered.map((entry) => entry.doc));
    const mounts: { ready: Promise<void>; dispose(): void }[] = [];
    rendered.forEach((entry, index) => {
      if (index > 0) {
        const mark = document.createElement("div");
        mark.className = "export-chapter-break";
        mark.dataset["exportChapterBreak"] = String(index);
        mark.setAttribute("aria-hidden", "true");
        container.append(mark);
      }
      const heading = document.createElement("h1");
      heading.className = "export-chapter-title";
      heading.dataset["exportChapter"] = String(index);
      heading.dataset["exportDoc"] = entry.doc;
      heading.textContent = title(entry.doc);
      const body = document.createElement("div");
      // `markdown-rendered` è un contenitore per chi misura: i suoi blocchi
      // si impaginano uno per uno, come quelli di una nota sola.
      body.className = "markdown-rendered export-chapter";
      body.dataset["exportChapter"] = String(index);
      container.append(heading, body);
      if (options.mount) mounts.push(options.mount(body, entry.rendered, entry.doc));
      else setSanitizedHtml(body, entry.rendered.html);
      markChapterLinks(body, entry.doc, targets);
    });
    return {
      // I media arrivano dopo: i collegamenti si segnano anche nelle note
      // trascluse, quando ci sono.
      ready: Promise.all(mounts.map((m) => m.ready)).then(() => {
        rendered.forEach((entry, index) => {
          const body = container.querySelector<HTMLElement>(`.export-chapter[data-export-chapter="${index}"]`);
          if (body) markChapterLinks(body, entry.doc, targets);
        });
      }),
      dispose() {
        for (const m of mounts) m.dispose();
        container.replaceChildren();
      },
    };
  };

  return {
    render,
    mount,
    measure: (page) => new BookMeasure(page),
    skipped: () => skipped,
    chapters: () => rendered.map((entry) => entry.doc),
  };
}

/// La misura della resa di un libro: quella di una nota, coi segni fra i
/// capitoli letti come interruzioni di pagina «capitolo».
export class BookMeasure implements BlockSource {
  private readonly inner: PrintMeasure;

  constructor(page: HTMLElement) {
    this.inner = new PrintMeasure(page);
  }

  get count(): number {
    return this.inner.count;
  }

  measure(index: number, depth: MeasureDepth): MeasuredBlock {
    const element = this.inner.blocks[index];
    const chapter = element?.dataset["exportChapterBreak"];
    if (chapter === undefined) return this.inner.measure(index, depth);
    const { top } = this.inner.measure(index, "stima");
    return { box: { kind: "separator", id: `${CHAPTER_BREAK_PREFIX}${chapter}`, height: 0 }, top, bottom: top, exact: true };
  }

  dispose(): void {
    this.inner.dispose();
  }
}
