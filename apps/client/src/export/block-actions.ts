// Il clic sulla pagina (E28, T76; il prototipo, passo 29): un clic su un
// blocco delle pagine dello spazio «Esporta in PDF» apre le sue regolazioni.
//
// - «Comincia qui una pagina nuova» (D17 A) scrive `<!-- pagina -->` nella
//   nota, sulla riga prima del blocco; lo stesso gesto su un blocco che ce
//   l'ha già la toglie. La scrittura passa dalla sessione del documento come
//   quella di un altro riquadro, e l'avviso che la dice ha il suo «Annulla».
//   Con la nota in sola lettura la voce è spenta e dice perché. Le pagine si
//   rifanno da sole: la nota cambiata si salva e la resa si chiede di nuovo.
// - «Lascia fuori dal PDF» non tocca la nota: il blocco si riconosce dalla
//   sezione (i titoli sopra di lui) e dal contenuto, come nella memoria
//   d'esportazione di T68 (`pdf_export/memory.rs`). Un blocco che cambia non
//   è più lo stesso: l'esclusione si perde, e un avviso lo dice.
// - Lo stile di quel solo diagramma (T75).
// - «Regola: …» apre la sezione che regola quella specie di blocco.
// - «Vai al blocco nella nota» chiude lo spazio e porta il cursore lì.
//
// Un blocco «della nota» è quello di cui la resa per la stampa dice la
// posizione nel sorgente (`sourceSpanOf`): il titolo della pagina, una nota
// trasclusa, un capitolo di un libro (T78) non lo sono, e del loro menu
// restano soltanto le voci che non scrivono e non portano nella nota.

import { plural, t, type Key } from "../i18n/strings";
import { byteToCharIndex } from "../rules/offsets";
import { PAGE_BREAK_LINE, isPageBreak } from "../rules/page-break";
import { showContextMenu, type MenuHeader, type MenuItem } from "../ui/menu";
import { notify } from "../ui/notify";
import { blockId, printBlocks, sourceSpanOf } from "./paginate/measure";
import { exportDiagramStyleName } from "./sections/diagrams";
import { SECTIONS } from "./sections/index";
import { EXPORT_DIAGRAM_STYLES } from "./vectors";

type Span = { readonly start: number; readonly end: number };

// --- La nota ----------------------------------------------------------------

/// La nota dello spazio, per le voci che la scrivono o ci portano. Chi apre lo
/// spazio su una nota sola la dà; il libro no.
export interface ExportNote {
  /// Il testo di cui le pagine sono la resa, `null` se non si sa (la nota
  /// aveva modifiche non salvate quando la resa è partita).
  shown(): string | null;
  /// Il testo di adesso, `null` se la nota non è aperta.
  current(): string | null;
  /// Perché la nota adesso non si scrive, in una frase; `null` se si scrive.
  readOnly(): string | null;
  /// Sostituisce `before`, il testo di adesso, con `after`; `false` se la
  /// nota non l'ha preso (è cambiata nel frattempo).
  write(before: string, after: string): boolean;
  /// Chiude lo spazio e porta al punto della nota (byte UTF-8).
  reveal(span: Span): void;
}

/// Il testo con `<!-- pagina -->` sulla riga prima di quella dove comincia
/// il blocco (`start`, in byte UTF-8). `null` se il blocco non comincia una
/// riga: sta dentro un altro (una citazione, un elenco).
export function withPageBreak(text: string, start: number): string | null {
  const at = byteToCharIndex(text, start);
  if (start < 0 || at > text.length) return null;
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  if (!/^[ \t]*$/u.test(text.slice(lineStart, at))) return null;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return `${text.slice(0, lineStart)}${PAGE_BREAK_LINE}${eol}${text.slice(lineStart)}`;
}

/// Il testo senza l'interruzione a mano che sta in `span` (byte UTF-8), con
/// la sua riga. `null` se lì non c'è più.
export function withoutPageBreak(text: string, span: Span): string | null {
  const from = byteToCharIndex(text, span.start);
  const to = byteToCharIndex(text, span.end);
  if (span.start < 0 || to > text.length || !isPageBreak(text.slice(from, to))) return null;
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  if (!/^[ \t]*$/u.test(text.slice(lineStart, from))) return null;
  const lineEnd = text.indexOf("\n", to);
  if (lineEnd >= 0 && !/^[ \t\r]*$/u.test(text.slice(to, lineEnd))) return null;
  return text.slice(0, lineStart) + (lineEnd < 0 ? "" : text.slice(lineEnd + 1));
}

// --- Riconoscere un blocco --------------------------------------------------

/// Un blocco lasciato fuori, riconosciuto come nella memoria della nota
/// (`RiferimentoBlocco` di T68): i titoli della sezione, dal più alto, il
/// suo contenuto e quante volte lo stesso contenuto viene prima nella stessa
/// sezione. `preview` è per gli avvisi.
export interface BlockRef {
  readonly section: readonly string[];
  readonly content: string;
  readonly occurrence: number;
  readonly preview: string;
}

interface Described {
  readonly element: HTMLElement;
  readonly id: string;
  readonly ref: BlockRef;
}

const PREVIEW = 48;

function flat(text: string | null): string {
  return (text ?? "").replace(/\s+/gu, " ").trim();
}

/// Il contenuto di un blocco: la specie e il testo; per ciò che non ha testo
/// (un'immagine, un diagramma) ciò che lo distingue.
function contentOf(element: HTMLElement): string {
  const text = flat(element.textContent);
  const image = element.matches("img") ? element : element.querySelector("img");
  const extra = text === "" ? (image?.getAttribute("alt") ?? image?.getAttribute("src") ?? "") : "";
  return `${element.tagName.toLowerCase()}\u0000${text}\u0000${extra}`;
}

function headingLevel(element: HTMLElement): number {
  if (!/^H[1-6]$/u.test(element.tagName) || element.parentElement?.classList.contains("print-page")) return 0;
  return Number(element.tagName[1]);
}

/// Tutti i blocchi della resa, anche quelli già nascosti, con l'identità che
/// lo spazio usa per lasciarli fuori e il riferimento che li ritrova.
function describeAll(page: HTMLElement): Described[] {
  const out: Described[] = [];
  const headings: string[] = [];
  const seen = new Map<string, number>();
  printBlocks(page, { hidden: true }).forEach((element, index) => {
    const content = contentOf(element);
    const section = headings.filter(Boolean);
    const key = JSON.stringify([section, content]);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const text = flat(element.textContent);
    const preview = text.length > PREVIEW ? `${text.slice(0, PREVIEW - 1)}…` : text;
    out.push({ element, id: blockId(element, index), ref: { section, content, occurrence, preview } });
    const level = headingLevel(element);
    if (level > 0) {
      headings.length = level - 1;
      headings[level - 1] = text;
    }
  });
  return out;
}

function sameRef(a: BlockRef, b: BlockRef): boolean {
  return a.content === b.content && a.occurrence === b.occurrence && a.section.length === b.section.length && a.section.every((name, i) => name === b.section[i]);
}

/// I blocchi lasciati fuori dal PDF, per lo spazio aperto.
export class BlockExclusions {
  #refs: BlockRef[] = [];
  #ids: string[] = [];

  /// Le identità dei blocchi lasciati fuori nella resa di adesso
  /// (`PrintLayout.excluded`).
  get ids(): readonly string[] {
    return this.#ids;
  }

  get count(): number {
    return this.#refs.length;
  }

  /// Il blocco `element` della resa `page`: chi è, e come si ritrova.
  describe(page: HTMLElement, element: HTMLElement): { readonly id: string; readonly ref: BlockRef } | null {
    const found = describeAll(page).find((block) => block.element === element);
    return found ? { id: found.id, ref: found.ref } : null;
  }

  add(ref: BlockRef, id: string): void {
    if (this.#refs.some((other) => sameRef(other, ref))) return;
    this.#refs.push(ref);
    this.#ids = [...this.#ids.filter((other) => other !== id), id];
  }

  remove(ref: BlockRef, id: string): boolean {
    const before = this.#refs.length;
    this.#refs = this.#refs.filter((other) => !sameRef(other, ref));
    this.#ids = this.#ids.filter((other) => other !== id);
    return this.#refs.length !== before;
  }

  clear(): void {
    this.#refs = [];
    this.#ids = [];
  }

  /// Ritrova i blocchi lasciati fuori in una resa nuova (la nota è cambiata):
  /// `changed` se le identità sono altre, `lost` i blocchi che non ci sono più
  /// come erano, dimenticati.
  resolve(page: HTMLElement): { readonly changed: boolean; readonly lost: readonly BlockRef[] } {
    if (this.#refs.length === 0) {
      const changed = this.#ids.length > 0;
      this.#ids = [];
      return { changed, lost: [] };
    }
    const blocks = describeAll(page);
    const kept: BlockRef[] = [];
    const lost: BlockRef[] = [];
    const ids: string[] = [];
    for (const ref of this.#refs) {
      const found = blocks.find((block) => sameRef(block.ref, ref));
      if (found) {
        kept.push(ref);
        ids.push(found.id);
      } else lost.push(ref);
    }
    const changed = ids.length !== this.#ids.length || ids.some((id) => !this.#ids.includes(id));
    this.#refs = kept;
    this.#ids = ids;
    return { changed, lost };
  }
}

/// La riga della sezione Contenuto che rimette i blocchi lasciati fuori (il
/// prototipo, passo 29: il collegamento «Rimetti i … blocchi lasciati fuori»,
/// o la nota che dice come si fa).
export function exclusionsRow(count: number, restore: () => void): HTMLElement {
  if (count === 0) {
    const note = document.createElement("p");
    note.className = "export-note";
    note.textContent = t("pdf_export.block.skip_how");
    return note;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.id = "export-block-restore-all";
  button.className = "export-link";
  button.textContent = plural(count, "pdf_export.block.restore_all.one", "pdf_export.block.restore_all.other");
  button.addEventListener("click", restore);
  return button;
}

/// Il riassunto della sezione Contenuto con dei blocchi lasciati fuori.
export function exclusionsSummary(count: number): string {
  return plural(count, "pdf_export.block.skipped_count.one", "pdf_export.block.skipped_count.other");
}

// --- Il menu ----------------------------------------------------------------

/// La specie di un blocco della resa, per la testata del menu e la sezione
/// che la regola (il prototipo, `NAME` e `SECOF`).
type Kind =
  | "title" | "heading" | "paragraph" | "bullet" | "ordered" | "task" | "quote" | "callout" | "details" | "embed"
  | "separator" | "table" | "image" | "code" | "diagram" | "formula" | "block";

const SECTION_OF: Partial<Record<Kind, string>> = {
  title: "caratteri",
  heading: "caratteri",
  paragraph: "caratteri",
  bullet: "caratteri",
  ordered: "caratteri",
  quote: "caratteri",
  task: "contenuto",
  details: "contenuto",
  embed: "contenuto",
  callout: "colori",
  code: "colori",
  table: "colori",
  diagram: "diagrammi",
};

function kindOf(element: HTMLElement): Kind {
  const tag = element.tagName;
  if (element.matches(".mermaid-diagram") || element.querySelector(":scope > .mermaid-diagram")) return "diagram";
  if (/^H[1-6]$/u.test(tag)) return headingLevel(element) === 0 ? "title" : "heading";
  if (tag === "LI") return element.classList.contains("task") ? "task" : element.parentElement?.tagName === "OL" ? "ordered" : "bullet";
  if (element.classList.contains("callout")) return "callout";
  if (element.classList.contains("embed")) return "embed";
  if (element.classList.contains("fub-details") || tag === "DETAILS") return "details";
  if (element.classList.contains("math-block") || element.querySelector(":scope > .math-block")) return "formula";
  if (tag === "BLOCKQUOTE") return "quote";
  if (tag === "HR") return "separator";
  if (tag === "TABLE" || element.querySelector(":scope > table")) return "table";
  if (tag === "PRE") return "code";
  if (tag === "FIGURE" || tag === "IMG" || (tag === "P" && flat(element.textContent) === "" && element.querySelector("img"))) return "image";
  if (tag === "P") return "paragraph";
  return "block";
}

/// Le specie che hanno già il loro nome nella testata del menu dell'editor:
/// lo stesso nome, una stringa sola.
const EDITOR_HEADS: Partial<Record<Kind, Key>> = {
  paragraph: "editor_menu.head.text",
  bullet: "editor_menu.head.bullet",
  ordered: "editor_menu.head.ordered",
  code: "editor_menu.head.code",
  table: "editor_menu.head.table",
  image: "editor_menu.head.image",
  block: "editor_menu.head.block",
};

function kindName(element: HTMLElement): string {
  const kind = kindOf(element);
  if (kind === "heading") return t("pdf_export.block.kind.heading", { level: element.tagName[1]! });
  return t(EDITOR_HEADS[kind] ?? (`pdf_export.block.kind.${kind}` as Key));
}

/// Ciò che lo spazio dà al menu del blocco.
export interface BlockActionsHost {
  /// La resa misurata, quella delle pagine.
  page(): HTMLElement | null;
  readonly exclusions: BlockExclusions;
  /// I blocchi lasciati fuori sono cambiati: si rifanno le pagine.
  excludedChanged(): void;
  openSection(id: string): void;
  /// Lo stile dato a un diagramma solo (`undefined`: quello di tutti).
  diagramStyle(index: number): string | undefined;
  setDiagramStyle(index: number, style: string | null): void;
  readonly note?: ExportNote;
}

/// Il blocco toccato: l'elemento della resa e se comincia già una pagina.
export interface BlockTarget {
  readonly element: HTMLElement;
  readonly firstOnPage: boolean;
}

/// Dove scrivere l'interruzione per un blocco: prima del blocco di primo
/// livello che lo contiene, se il blocco ne è l'inizio (la prima voce di un
/// elenco). `marker`: l'interruzione che c'è già, subito prima.
interface BreakPlace {
  readonly start: number;
  readonly marker: Span | null;
  readonly inside: boolean;
}

function breakPlace(element: HTMLElement): BreakPlace | null {
  let top: HTMLElement = element;
  while (top.parentElement && !top.parentElement.classList.contains("print-body")) {
    if (top.parentElement.classList.contains("print-page")) return null;
    top = top.parentElement;
  }
  if (!top.parentElement) return null;
  const span = sourceSpanOf(top);
  if (!span) return null;
  const inside = top !== element && printBlocks(top, { hidden: true })[0] !== element;
  const before = top.previousElementSibling;
  const marker = before?.hasAttribute("data-page-break") ? sourceSpanOf(before) : null;
  return { start: span.start, marker, inside };
}

function diagramIndex(element: HTMLElement): number | null {
  const figure = element.matches(".mermaid-diagram") ? element : element.querySelector<HTMLElement>(".mermaid-diagram");
  if (!figure || figure.closest(".embed, .export-chapter")) return null;
  const index = Number(figure.dataset["exportDiagram"]);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

/// La testata e le voci del menu di un blocco.
export function blockMenu(target: BlockTarget, host: BlockActionsHost): { readonly header: MenuHeader; readonly items: MenuItem[] } {
  const { element } = target;
  const items: MenuItem[] = [];
  const span = sourceSpanOf(element);
  const note = host.note;
  const real = span !== null;
  if (real && note) {
    const place = breakPlace(element);
    if (place) items.push(breakItem(target, place, note));
  }
  if (real) items.push(skipItem(element, host));
  const diagram = diagramIndex(element);
  if (diagram !== null) {
    const group = t("pdf_export.block.diagram_style");
    const own = host.diagramStyle(diagram) ?? null;
    const choices: (string | null)[] = [null, ...EXPORT_DIAGRAM_STYLES.filter((style) => style !== "nota")];
    for (const style of choices) {
      items.push({
        label: style === null ? t("pdf_export.block.diagram_like_others") : style === "tema" ? t("pdf_export.block.diagram_theme") : exportDiagramStyleName(style as never),
        group,
        choice: "radio",
        checked: own === style,
        run: () => host.setDiagramStyle(diagram, style),
      });
    }
  }
  const sectionId = SECTION_OF[kindOf(element)];
  const section = sectionId ? SECTIONS.find((candidate) => candidate.id === sectionId) : undefined;
  if (section) {
    items.push({ label: t("pdf_export.block.adjust", { section: t(section.title) }), icon: "export-adjust", separator: true, run: () => host.openSection(section.id) });
  }
  if (span && note) {
    items.push({ label: t("pdf_export.block.reveal"), icon: "export-goto", separator: !section, run: () => note.reveal(span) });
  }
  return { header: { kind: kindName(element) }, items };
}

function breakItem(target: BlockTarget, place: BreakPlace, note: ExportNote): MenuItem {
  const checked = place.marker !== null;
  const readOnly = note.readOnly();
  let description: string | undefined;
  if (readOnly !== null) description = readOnly;
  else if (place.inside) description = t("pdf_export.block.break_inside");
  else if (target.firstOnPage && !checked) description = t("pdf_export.block.break_first");
  return {
    label: t("pdf_export.block.break"),
    icon: "export-break",
    choice: "checkbox",
    checked,
    disabled: readOnly !== null || place.inside,
    ...(description === undefined ? {} : { description }),
    run: () => toggleBreak(place, note),
  };
}

/// Scrive o toglie l'interruzione, sul testo di cui le pagine sono la resa:
/// le posizioni sono di quel testo.
function toggleBreak(place: BreakPlace, note: ExportNote): void {
  const reason = note.readOnly();
  if (reason !== null) {
    notify(reason, "info");
    return;
  }
  const now = note.current();
  if (now === null || note.shown() !== now) {
    notify(t("pdf_export.block.break_changing"), "info");
    return;
  }
  const after = place.marker ? withoutPageBreak(now, place.marker) : withPageBreak(now, place.start);
  if (after === null || !note.write(now, after)) {
    notify(t("pdf_export.block.break_failed"), "guasto");
    return;
  }
  const added = place.marker === null;
  notify(t(added ? "pdf_export.block.break_added" : "pdf_export.block.break_removed"), "info", {
    label: t("app.undo"),
    hint: t(added ? "pdf_export.block.undo_added" : "pdf_export.block.undo_removed"),
    run: () => {
      // Si torna indietro soltanto se la nota è ancora come l'ha lasciata
      // il gesto: altrimenti si coprirebbe ciò che è stato scritto dopo.
      const current = note.current();
      if (current !== after || !note.write(after, now)) notify(t("pdf_export.block.undo_stale"), "info");
    },
  });
}

function skipItem(element: HTMLElement, host: BlockActionsHost): MenuItem {
  return {
    label: t("pdf_export.block.skip"),
    description: t("pdf_export.block.skip_hint"),
    icon: "eye",
    run: () => {
      const page = host.page();
      const found = page ? host.exclusions.describe(page, element) : null;
      if (!found) return;
      host.exclusions.add(found.ref, found.id);
      host.excludedChanged();
      notify(t("pdf_export.block.skipped"), "info", {
        label: t("pdf_export.block.restore"),
        hint: t("pdf_export.block.restore_hint"),
        run: () => {
          if (host.exclusions.remove(found.ref, found.id)) host.excludedChanged();
        },
      });
    },
  };
}

// --- Il clic ----------------------------------------------------------------

export interface BlockClickOptions extends BlockActionsHost {
  /// Il contenitore delle pagine (`ExportPages.element`).
  readonly pages: HTMLElement;
  /// Le pagine sono miniature (la vista «tutte»): il clic sceglie la pagina.
  allPages(): boolean;
}

const SELECTED = "is-selected";

/// Ascolta il clic sulle fasce delle pagine e apre il menu del blocco, col
/// blocco contornato finché il menu è aperto. Torna il disposer.
export function attachBlockActions(options: BlockClickOptions): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || options.allPages()) return;
    const band = (event.target as Element | null)?.closest?.<HTMLElement>(".export-fascia[data-block]");
    const page = options.page();
    if (!band || !page || !options.pages.contains(band)) return;
    const id = band.dataset["block"] ?? "";
    const index = Number(band.dataset["blockIndex"]);
    const element = Number.isSafeInteger(index) ? printBlocks(page)[index] : undefined;
    // Le pagine e la resa sono della stessa impaginazione, o il clic non vale.
    if (!element || blockId(element, index) !== id) return;
    event.preventDefault();
    const bands = [...options.pages.querySelectorAll<HTMLElement>(".export-fascia[data-block]")].filter((other) => other.dataset["block"] === id);
    const firstOnPage = bands.some((other) => other.dataset["pageTop"] !== undefined);
    const menu = blockMenu({ element, firstOnPage }, options);
    for (const other of bands) other.classList.add(SELECTED);
    showContextMenu({ x: event.clientX, y: event.clientY }, menu.items, {
      header: menu.header,
      label: menu.header.kind,
      pointer: event.detail > 0,
      onClose: () => {
        for (const other of bands) other.classList.remove(SELECTED);
      },
    });
  };
  options.pages.addEventListener("click", onClick);
  return () => options.pages.removeEventListener("click", onClick);
}
