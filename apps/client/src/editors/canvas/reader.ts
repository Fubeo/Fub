// Il lettore (N6 T76, S10 di `lavagna.md`): Spazio toccato e lasciato con
// una scheda di nota scelta apre la nota intera, grande, sopra l'area della
// lavagna (non la finestra). Con un estratto (T75) le sue sezioni sono
// segnate e la prima è già in vista; a lato i titoli della nota, quelli
// dell'estratto segnati. Le frecce, PgSu e PgGiù scorrono tutta la nota; una
// sezione fuori dall'estratto, quella su cui si legge, si aggiunge con Invio o
// «+ Aggiungi all'estratto». Esc o Spazio tornano alla lavagna com'era.
//
// La resa è quella della scheda di nota (`PartsPickerPort.show`, la stessa
// porta del selettore, T74): la nota intera dentro la pagina del lettore, che
// poi si divide in una `section` per titolo, dove i titoli resi stanno uno
// accanto all'altro (così è la resa di `renderEmbed`). Un titolo che il
// sommario non ha resta dentro la sezione di prima. Qui stanno le regole pure
// (quali sezioni sono dell'estratto, dove va una sezione aggiunta) e il
// riquadro; quando si apre, il commit su `fub:parts` (T73) e la scelta li
// tiene la tela (`engine.ts`).
//
// In v1 per le note; i PDF arrivano con T83.

import { isErrorKind } from "../../host/errors";
import { t } from "../../i18n/strings";
import { trapFocus } from "../../ui/a11y";
import { iconEl } from "../../ui/icons";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { excerptPartsLabel, sectionHeading } from "./excerpt";
import { partsSections, type PartsHeading } from "./parts-picker";

/// Quanto dura al più il tocco di Spazio che apre il lettore (ms), dal tasto
/// giù al tasto su: oltre, è lo spostamento della vista (T53). Non dipende
/// dalla ripetizione del sistema: conta solo il primo tasto giù.
export const READER_TAP_MS = 300;
/// Di quanto può muoversi il puntatore durante il tocco (px): oltre, è uno
/// spostamento.
export const READER_TAP_SLOP = 3;
/// Di quanto scorrono la nota le frecce (px).
export const READER_LINE = 40;
/// Lo spazio sopra una sezione portata in vista (px), come il prototipo.
export const READER_TOP_GAP = 24;

/// Ciò che il lettore chiede alla shell: il sommario e la resa della nota
/// (le porte del selettore, T74) e, se c'è, l'ascolto dei cambi del file.
export interface ReaderPort {
  outline(path: string): Promise<readonly PartsHeading[]>;
  show(path: string, heading: string | null, host: HTMLElement, life: Lifetime): Promise<void>;
  watch?(path: string, changed: () => void): () => void;
}

/// Un titolo della nota nel lettore.
export interface ReaderSection {
  /// La posizione nel sommario: l'identità, unica anche fra due titoli uguali.
  readonly index: number;
  readonly text: string;
  /// Ciò che si scrive dopo il `#` (`partsSections`).
  readonly key: string;
  /// Il livello del titolo (`#` = 1).
  readonly level: number;
  /// Il rientro nei titoli a lato, da 1.
  readonly depth: number;
}

/// Le sezioni della nota dai suoi titoli, in ordine di sorgente. Il rientro
/// toglie il titolo della nota: un solo titolo di livello più alto, in testa,
/// è il nome della nota e non rientra.
export function readerSections(headings: readonly PartsHeading[]): ReaderSection[] {
  const sections = partsSections(headings).map((section) => ({
    index: section.index,
    text: section.text,
    key: section.key,
    level: headings[section.index]!.level,
  }));
  if (sections.length === 0) return [];
  const top = Math.min(...sections.map((section) => section.level));
  const tops = sections.filter((section) => section.level === top).length;
  const titled = sections.length > 1 && tops === 1 && sections[0]!.level === top;
  const levels = [...new Set(sections.map((section) => section.level))].sort((a, b) => a - b);
  return sections.map((section) => {
    const rank = levels.indexOf(section.level) + 1;
    return { ...section, depth: Math.max(1, titled ? rank - 1 : rank) };
  });
}

/// Il titolo che è il nome della nota: il solo di livello più alto, in testa.
/// Non sta fra i titoli a lato. `null` se non c'è.
export function readerTitleSection(sections: readonly ReaderSection[]): ReaderSection | null {
  const first = sections[0];
  if (!first || sections.length < 2) return null;
  return sections.every((section, at) => at === 0 || section.level > first.level) ? first : null;
}

/// La sezione che una chiave dell'estratto mostra: quella con la stessa
/// chiave, sennò la prima col suo titolo (il più interno, come Obsidian).
export function sectionOfKey(sections: readonly ReaderSection[], key: string): ReaderSection | null {
  const exact = sections.find((section) => section.key === key);
  if (exact) return exact;
  const heading = sectionHeading(key);
  if (heading === null) return null;
  return sections.find((section) => section.text === heading.trim()) ?? null;
}

/// Le sezioni (per `index`) che l'estratto mostra: quelle delle sue chiavi
/// e i loro sottotitoli, perché la scheda le rende con tutto ciò che c'è
/// sotto fino al titolo dopo dello stesso livello.
export function excerptIndexes(sections: readonly ReaderSection[], keys: readonly string[]): Set<number> {
  const inside = new Set<number>();
  for (const key of keys) {
    const section = sectionOfKey(sections, key);
    if (!section) continue;
    const at = sections.indexOf(section);
    inside.add(section.index);
    for (let next = at + 1; next < sections.length && sections[next]!.level > section.level; next++) {
      inside.add(sections[next]!.index);
    }
  }
  return inside;
}

/// Le chiavi dell'estratto con `adding` aggiunta: le chiavi di prima restano
/// com'erano scritte, nel loro ordine (anche quelle che la nota non ha più),
/// e la nuova va al suo posto nella nota, prima della prima chiave che sta
/// più in basso. Già dentro: le chiavi di prima.
export function keysWith(sections: readonly ReaderSection[], keys: readonly string[], adding: ReaderSection): string[] {
  if (excerptIndexes(sections, keys).has(adding.index)) return [...keys];
  const out = [...keys];
  const at = out.findIndex((key) => {
    const section = sectionOfKey(sections, key);
    return section !== null && section.index > adding.index;
  });
  if (at < 0) out.push(adding.key);
  else out.splice(at, 0, adding.key);
  return out;
}

/// Divide la resa della nota in `page` in una `section` per titolo del
/// sommario: i figli del contenitore dei titoli, dal titolo fino al prossimo.
/// Ciò che sta prima del primo titolo è una sezione senza titolo. Torna le
/// sezioni nell'ordine della nota; ognuna col suo `data-index` se ha un
/// titolo del sommario.
export function splitSections(page: HTMLElement, sections: readonly ReaderSection[]): HTMLElement[] {
  const headings = [...page.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
  const root = headings[0]?.parentElement ?? null;
  const starts = new Map<Element, ReaderSection>();
  if (root !== null) {
    let next = 0;
    for (const heading of headings) {
      if (heading.parentElement !== root) continue;
      const text = (heading.textContent ?? "").trim();
      const level = Number(heading.tagName.slice(1));
      for (let look = next; look < sections.length; look++) {
        const section = sections[look]!;
        if (section.text === text && section.level === level) {
          starts.set(heading, section);
          next = look + 1;
          break;
        }
      }
    }
  }
  const out: HTMLElement[] = [];
  const block = (section: ReaderSection | null): HTMLElement => {
    const element = document.createElement("section");
    element.className = "canvas-reader-section";
    if (section) {
      element.dataset.index = String(section.index);
      element.dataset.section = section.key;
    }
    out.push(element);
    return element;
  };
  if (root === null || starts.size === 0) {
    const only = block(null);
    only.append(...page.childNodes);
    page.append(only);
    return out;
  }
  let current: HTMLElement | null = null;
  for (const child of [...root.childNodes]) {
    const section = child instanceof Element ? starts.get(child) : undefined;
    if (section) {
      current = block(section);
      root.insertBefore(current, child);
    } else if (current === null) {
      current = block(null);
      root.insertBefore(current, child);
    }
    current.append(child);
  }
  return out;
}

export interface ReaderOptions {
  /// Dove si mette: l'area della lavagna, che il lettore copre.
  readonly host: HTMLElement;
  /// Il file della nota.
  readonly path: string;
  /// Le chiavi dell'estratto; vuote per la nota intera.
  readonly excerpt: readonly string[];
  /// Si possono aggiungere sezioni (un estratto, la lavagna non in sola lettura).
  readonly writable: boolean;
  readonly port: ReaderPort;
  /// Invio o «+ Aggiungi all'estratto»: le chiavi nuove, già in ordine.
  readonly onAdd: (keys: readonly string[]) => void;
  /// Il lettore si è chiuso: Esc, Spazio, la crocetta (`back`), il file
  /// tolto dal vault (`missing`), o la tela (`closed`).
  readonly onClose: (reason: ReaderCloseReason) => void;
  readonly lifetime: Lifetime;
}

export type ReaderCloseReason = "back" | "missing" | "closed";

export interface ReaderHandle {
  readonly element: HTMLElement;
  /// La scheda è cambiata: un'altra scelta di sezioni, o la sola lettura.
  update(next: { readonly excerpt: readonly string[]; readonly writable: boolean }): void;
  close(): void;
  readonly closed: boolean;
  /// Si è resa la prima volta (le prove la aspettano).
  readonly ready: Promise<void>;
}

/// Il nome della nota senza la cartella e senza `.md`.
function noteName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.(md|markdown)$/i, "") || base;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let readerCount = 0;

/// Apre il lettore sulla nota `path`, sopra l'area della lavagna.
export function openReader(options: ReaderOptions): ReaderHandle {
  const life = openLifetime();
  const id = `canvas-reader-${++readerCount}`;
  let excerpt = [...options.excerpt];
  let writable = options.writable;
  let sections: ReaderSection[] = [];
  let blocks: HTMLElement[] = [];
  let current: number | null = null;
  let renderLife: Lifetime | null = null;
  let round = 0;
  let first = true;
  let closed = false;

  const root = el("div", "canvas-reader");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.tabIndex = -1;
  root.dataset.source = "note";
  root.setAttribute("aria-labelledby", `${id}-title`);

  // La testata: il nome e le parti, il suggerimento, la crocetta.
  const head = el("div", "canvas-reader-head");
  const title = el("h2", "canvas-reader-title");
  title.id = `${id}-title`;
  title.append(el("span", "", noteName(options.path)));
  const parts = el("span", "canvas-excerpt-parts");
  title.append(parts);
  const hint = el("span", "canvas-reader-hint", t("canvas.reader.back"));
  const close = el("button", "canvas-parts-close");
  close.type = "button";
  close.setAttribute("aria-label", t("canvas.reader.close"));
  close.title = t("canvas.reader.close");
  close.setAttribute("aria-keyshortcuts", "Escape Space");
  const cross = iconEl("close");
  if (cross) {
    cross.setAttribute("aria-hidden", "true");
    close.append(cross);
  }
  head.append(title, hint, close);

  // A lato i titoli; in mezzo la nota.
  const outline = el("nav", "canvas-reader-outline");
  outline.setAttribute("aria-label", t("canvas.reader.outline"));
  const doc = el("div", "canvas-reader-doc");
  doc.tabIndex = 0;
  doc.setAttribute("aria-label", t("canvas.reader"));
  const page = el("article", "canvas-reader-page");
  doc.append(page);
  root.append(head, outline, doc);

  // Il pulsante di una sezione fuori dall'estratto, su quella dove si legge.
  const add = el("button", "kit-button canvas-reader-add", t("canvas.reader.add"));
  add.type = "button";
  add.dataset.kind = "normal";
  add.setAttribute("aria-keyshortcuts", "Enter");

  const sectionAt = (index: number | null): ReaderSection | null =>
    index === null ? null : sections.find((section) => section.index === index) ?? null;
  const blockOf = (index: number): HTMLElement | null => blocks.find((block) => block.dataset.index === String(index)) ?? null;
  const addable = (section: ReaderSection | null): section is ReaderSection =>
    section !== null && writable && excerpt.length > 0 && !excerptIndexes(sections, excerpt).has(section.index);

  /// Rimette i segni: la testata, le sezioni dell'estratto, quella dove si
  /// legge, il pulsante.
  function mark(): void {
    const label = excerpt.length > 0 ? excerptPartsLabel({ kind: "sections", sections: excerpt }) : "";
    if (parts.textContent !== label) parts.textContent = label;
    parts.hidden = label === "";
    const inside = excerptIndexes(sections, excerpt);
    // La sezione dove si legge si vede nella nota solo dove si può aggiungere.
    const adding = writable && excerpt.length > 0;
    for (const block of blocks) {
      const index = block.dataset.index === undefined ? null : Number(block.dataset.index);
      block.toggleAttribute("data-in-excerpt", index !== null && inside.has(index));
      block.toggleAttribute("data-current", adding && index !== null && index === current);
    }
    for (const row of outline.querySelectorAll<HTMLElement>(".canvas-reader-outline-row")) {
      const index = Number(row.dataset.index);
      row.toggleAttribute("data-in-excerpt", inside.has(index));
      if (index === current) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
    const section = sectionAt(current);
    const host = section ? blockOf(section.index) : null;
    if (addable(section) && host) {
      if (add.parentElement !== host) host.append(add);
    } else if (add.isConnected) {
      // Il pulsante che aveva il fuoco se ne va: il fuoco resta nella nota.
      const focused = document.activeElement === add;
      add.remove();
      if (focused) doc.focus({ preventScroll: true });
    }
  }

  /// La sezione `index` è quella dove si legge.
  function setCurrent(index: number | null): void {
    if (index === current) return;
    current = index;
    mark();
  }

  /// Porta la sezione `index` in cima alla nota, e ci legge.
  function reveal(index: number): void {
    const block = blockOf(index);
    if (!block) return;
    const top = block.getBoundingClientRect().top - doc.getBoundingClientRect().top + doc.scrollTop;
    doc.scrollTop = Math.max(0, top - READER_TOP_GAP);
    setCurrent(index);
  }

  /// Dopo uno scorrimento: si legge la prima sezione che arriva sotto la
  /// riga in cima.
  function readingLine(): void {
    if (blocks.length === 0) return;
    const line = doc.getBoundingClientRect().top + READER_TOP_GAP + 1;
    const block = blocks.find((one) => one.getBoundingClientRect().bottom > line) ?? blocks[blocks.length - 1]!;
    setCurrent(block.dataset.index === undefined ? null : Number(block.dataset.index));
  }

  function buildOutline(): void {
    const title = readerTitleSection(sections);
    const rows: HTMLButtonElement[] = [];
    for (const section of sections) {
      if (section === title) continue;
      const row = el("button", "canvas-reader-outline-row", section.text);
      row.type = "button";
      row.dataset.index = String(section.index);
      row.dataset.depth = String(Math.min(3, section.depth));
      row.title = section.text;
      rows.push(row);
    }
    const focused = document.activeElement instanceof HTMLElement && outline.contains(document.activeElement)
      ? document.activeElement.dataset.index ?? null
      : null;
    outline.replaceChildren(...rows);
    outline.hidden = rows.length === 0;
    if (focused !== null) (rows.find((row) => row.dataset.index === focused) ?? doc).focus({ preventScroll: true });
  }

  /// Rende la nota (all'apertura e a ogni cambio del file): il sommario, la
  /// resa intera, le sezioni. Una resa chiesta prima di un'altra non tocca
  /// niente; il file tolto chiude il lettore.
  async function render(): Promise<void> {
    const mine = ++round;
    const nextLife = openLifetime();
    const nextPage = el("article", "canvas-reader-page");
    let headings: readonly PartsHeading[] = [];
    try {
      headings = await options.port.outline(options.path);
    } catch {
      headings = [];
    }
    let failed: unknown = null;
    try {
      if (mine === round && !closed) await options.port.show(options.path, null, nextPage, nextLife);
    } catch (error) {
      failed = error ?? new Error("show");
    }
    if (mine !== round || closed) {
      nextLife.close();
      return;
    }
    if (failed !== null && isErrorKind(failed, "not_found")) {
      nextLife.close();
      finish("missing");
      return;
    }
    if (failed !== null) {
      nextPage.replaceChildren(el("p", "canvas-reader-unreadable", t("canvas.card.unreadable", { name: noteName(options.path) })));
    }
    sections = failed === null ? readerSections(headings) : [];
    const scroll = doc.scrollTop;
    blocks = splitSections(nextPage, sections);
    page.replaceChildren(...nextPage.childNodes);
    renderLife?.close();
    renderLife = nextLife;
    buildOutline();
    if (current !== null && !blockOf(current)) current = null;
    if (first) {
      first = false;
      // La prima sezione dell'estratto già in vista; la nota intera dall'inizio.
      const inside = excerptIndexes(sections, excerpt);
      const start = sections.find((section) => inside.has(section.index));
      if (start) reveal(start.index);
      else readingLine();
    } else {
      doc.scrollTop = scroll;
      readingLine();
    }
    mark();
  }

  function finish(reason: ReaderCloseReason): void {
    if (closed) return;
    closed = true;
    life.close();
    options.onClose(reason);
  }

  // Le frecce scorrono la nota da ogni punto del lettore; Spazio fuori da un
  // pulsante chiude (sopra un pulsante è il suo clic, come Invio); Invio fuori
  // da un pulsante aggiunge la sezione dove si legge.
  life.listen(root, "keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const onButton = event.target instanceof HTMLButtonElement;
    const stride = Math.max(READER_LINE, Math.round(doc.clientHeight * 0.9));
    let delta: number | null = null;
    switch (event.key) {
      case " ":
        if (onButton || event.shiftKey) return;
        event.preventDefault();
        if (!event.repeat) finish("back");
        return;
      case "Enter": {
        if (onButton) return;
        event.preventDefault();
        const section = sectionAt(current);
        if (addable(section)) options.onAdd(keysWith(sections, excerpt, section));
        return;
      }
      case "ArrowDown":
        delta = READER_LINE;
        break;
      case "ArrowUp":
        delta = -READER_LINE;
        break;
      case "PageDown":
        delta = stride;
        break;
      case "PageUp":
        delta = -stride;
        break;
      case "Home":
        delta = -doc.scrollTop;
        break;
      case "End":
        delta = doc.scrollHeight;
        break;
      default:
        return;
    }
    event.preventDefault();
    doc.scrollTop = Math.max(0, doc.scrollTop + delta);
    readingLine();
  });
  life.listen(doc, "scroll", () => readingLine());
  // Sotto il puntatore, la sezione dove si legge è quella che si indica.
  life.listen(doc, "pointermove", (event) => {
    const block = event.target instanceof Element ? event.target.closest<HTMLElement>(".canvas-reader-section") : null;
    if (block && block.dataset.index !== undefined) setCurrent(Number(block.dataset.index));
  });
  life.listen(outline, "click", (event) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>(".canvas-reader-outline-row") : null;
    if (row) reveal(Number(row.dataset.index));
  });
  life.listen(add, "click", () => {
    const section = sectionAt(current);
    if (addable(section)) options.onAdd(keysWith(sections, excerpt, section));
  });
  life.listen(close, "click", () => finish("back"));
  // Niente arriva alla lavagna sotto: né il puntatore né la rotella.
  for (const type of ["pointerdown", "wheel", "dblclick", "contextmenu"] as const) {
    life.listen(root, type, (event: Event) => event.stopPropagation());
  }
  if (options.port.watch) {
    const unwatch = options.port.watch(options.path, () => {
      if (!closed) void render();
    });
    life.add(unwatch);
  }
  options.lifetime.add(() => finish("closed"));

  options.host.append(root);
  life.add(() => root.remove());
  life.add(() => renderLife?.close());
  // Il fuoco resta dentro finché è aperto (Esc chiude); poi torna a chi lo
  // aveva, e la tela lo porta sulla scheda.
  life.add(trapFocus(root, () => finish("back")));
  doc.focus({ preventScroll: true });
  mark();
  const ready = render();

  return {
    element: root,
    update(next) {
      if (closed) return;
      excerpt = [...next.excerpt];
      writable = next.writable;
      mark();
    },
    close: () => finish("closed"),
    get closed() {
      return closed;
    },
    ready,
  };
}
