// Le pagine dello spazio «Esporta in PDF», come usciranno (E28, T70; il
// prototipo `.px-stage`, `.px-doc`, `.px-slot`, `.px-pg`, righe 1057–1074).
//
// L'impaginatore (`paginate/slices.ts`) misura la resa per la stampa in un
// contenitore fuori dallo schermo e dice, pagina per pagina, quali fasce di
// quali blocchi ci stanno e dove. Qui ogni pagina è un foglio della sua
// misura, scalato allo zoom: dentro, ogni fascia è una finestra alta quanto
// la fascia che mostra una copia del suo blocco, spostata in su di quanto la
// fascia comincia sotto il bordo del blocco. La copia porta con sé i
// contenitori della resa (la pagina di stampa, il corpo, l'elenco), così il
// CSS della Lettura la veste come l'originale e una voce d'elenco numerata
// tiene il suo numero.
//
// Si riempiono soltanto le pagine vicine a quelle che si vedono: una nota di
// 200 pagine ha 200 fogli vuoti della misura giusta e una manciata pieni.
// Lo scorrimento dice all'impaginatore quali pagine si vedono
// (`onVisible`), perché le prepari prima delle altre.
//
// I fogli sono quelli di `PageDecor` (T73): il frontespizio e le pagine
// dell'indice vengono prima di quelle della nota, e su ogni foglio lo spazio
// disegna ciò che non è la nota (frontespizio, indice, testata e piè). Senza,
// i fogli sono le pagine della nota e basta.
//
// Ogni foglio porta anche ciò che la sezione «Pagina» decide sopra le
// fasce (T72, `setMarks`): i margini a specchio, che sulle pagine pari
// scambiano destra e sinistra, la filigrana in diagonale sotto il testo e,
// sullo schermo, le quattro guide dei margini (`guides.ts`).

import { t } from "../i18n/strings";
import { printBlocks } from "./paginate/measure";
import type { Placement } from "./paginate/model";
import { frameOf, type PrintLayout, type SlicedResult, type VisiblePages } from "./paginate/slices";
import type { Sheet } from "./paginate/toc";
import type { ExportView } from "./toolbar";

/// Lo spazio fra due pagine, come `gap` di `.export-doc` (20 px).
const PAGE_GAP = 20;
/// Lo spazio interno del palco ai due lati, come lo conta il prototipo
/// (`st.clientWidth - 48`, riga 4607).
const STAGE_INSET = 48;
/// Quante pagine piene si tengono oltre quelle che si vedono, per parte.
const FILL_MARGIN = 1;
/// Oltre quante pagine dalle visibili una pagina piena si svuota.
const KEEP_MARGIN = 6;

/// Lo zoom di ogni vista, dalla larghezza utile del palco (`pxZoom`, riga 4606).
export function zoomFor(view: ExportView, stageWidth: number, pageWidth: number, free: number): number {
  const w = stageWidth - STAGE_INSET;
  if (view === "libera") return free;
  if (!(w > 0) || !(pageWidth > 0)) return 1;
  if (view === "adatta") return Math.min(1, w / pageWidth);
  if (view === "due") return Math.min(1, (w - PAGE_GAP) / (pageWidth * 2));
  return Math.min(0.34, (w - 60) / (pageWidth * 4));
}

/// Il passo dello zoom coi pulsanti: un decimo, fra un quinto e il doppio.
export function steppedZoom(current: number, step: -1 | 1): number {
  return Math.max(0.2, Math.min(2, Math.round((current + step * 0.1) * 10) / 10));
}

export interface PagesOptions {
  /// Il palco che scorre: le pagine ci stanno dentro.
  readonly stage: HTMLElement;
  /// Le pagine che si vedono sono cambiate.
  readonly onVisible: (visible: VisiblePages) => void;
  /// Nella vista «tutte», una pagina scelta: si torna a una pagina e la si
  /// porta sotto gli occhi.
  readonly onPick: (page: number) => void;
}

/// Ciò che sta sui fogli oltre alle fasce: non cambia l'impaginazione.
export interface PageMarks {
  /// I margini a specchio: sulle pagine pari destra e sinistra si scambiano.
  readonly mirror: boolean;
  /// La filigrana su ogni pagina; vuota, nessuna.
  readonly watermark: string;
}

const NO_MARKS: PageMarks = { mirror: false, watermark: "" };

/// I lati delle guide, coi nomi dei margini del profilo.
const GUIDES = ["sopra", "destra", "sotto", "sinistra"] as const;

/// I fogli e chi disegna su ciascuno ciò che non è la nota.
export interface PageDecor {
  readonly sheets: readonly Sheet[];
  /// Quanti fogli vengono prima delle pagine della nota.
  readonly front: number;
  /// Disegna sul foglio numero `ordinal` (da 0, fra tutti) ciò che non è la
  /// nota: `page` è il foglio, `body` lo spazio fra i margini.
  draw(page: HTMLElement, body: HTMLElement, sheet: Sheet, ordinal: number): void;
}

/// I fogli senza niente intorno: le pagine della nota.
function plainDecor(result: SlicedResult): PageDecor {
  const count = result.pagination.pages.length;
  return {
    sheets: Array.from({ length: count }, (_, index) => ({ kind: "pagina", index, number: String(index + 1), total: String(count), header: false, footer: false })),
    front: 0,
    draw: () => {},
  };
}

interface Drawn {
  readonly result: SlicedResult;
  readonly blocks: readonly HTMLElement[];
  readonly layout: PrintLayout;
  readonly decor: PageDecor;
}

export class ExportPages {
  readonly element: HTMLElement;
  private readonly stage: HTMLElement;
  private slots: HTMLElement[] = [];
  private readonly filled = new Set<number>();
  private drawn: Drawn | null = null;
  private colors: Readonly<Record<string, string>> = {};
  private marks: PageMarks = NO_MARKS;
  private view: ExportView = "adatta";
  private free = 1;
  private zoomNow = 1;
  private frame = 0;
  private lastVisible = "";
  private readonly observer: ResizeObserver | null;
  private readonly onScroll = () => this.schedule();

  constructor(private readonly options: PagesOptions) {
    this.stage = options.stage;
    this.element = document.createElement("div");
    this.element.className = "export-doc";
    this.element.dataset["view"] = "adatta";
    this.element.lang = document.documentElement.lang || "";
    this.stage.append(this.element);
    this.stage.addEventListener("scroll", this.onScroll, { passive: true });
    this.element.addEventListener("click", (event) => this.pick(event));
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (this.pick(event)) event.preventDefault();
    });
    // Senza `ResizeObserver` (happy-dom) lo zoom non segue la larghezza del palco.
    if (typeof ResizeObserver === "function") {
      this.observer = new ResizeObserver(() => this.relayoutZoom());
      this.observer.observe(this.stage);
    } else {
      this.observer = null;
    }
  }

  /// Lo zoom di adesso.
  get zoom(): number {
    return this.zoomNow;
  }

  get pageCount(): number {
    return this.slots.length;
  }

  /// I colori della carta: variabili sul contenitore delle pagine, senza
  /// ridisegnare niente (la seconda velocità di `slices.ts`).
  setColors(colors: Readonly<Record<string, string>>): void {
    for (const name of Object.keys(this.colors)) if (!(name in colors)) this.element.style.removeProperty(name);
    for (const [name, value] of Object.entries(colors)) this.element.style.setProperty(name, value);
    this.colors = { ...colors };
  }

  /// Lo specchio e la filigrana: si ridisegnano i fogli pieni, senza
  /// rifare l'impaginazione.
  setMarks(marks: PageMarks): void {
    if (marks.mirror === this.marks.mirror && marks.watermark === this.marks.watermark) return;
    this.marks = { mirror: marks.mirror, watermark: marks.watermark };
    for (const index of this.filled) this.clear(index);
    this.lastVisible = "";
    this.refresh();
  }

  /// Le pagine di un'impaginazione: i fogli per tutte, pieni quelli vicini.
  show(result: SlicedResult, source: HTMLElement, layout: PrintLayout, decor?: PageDecor): void {
    const page = source.querySelector<HTMLElement>(".print-page");
    this.drawn = { result, blocks: page ? printBlocks(page) : [], layout, decor: decor ?? plainDecor(result) };
    this.redraw();
  }

  /// Gli stessi blocchi con altri fogli intorno (la testata cambiata, il
  /// frontespizio acceso): niente da misurare, si ridisegnano i fogli.
  decorate(decor: PageDecor): void {
    if (!this.drawn) return;
    this.drawn = { ...this.drawn, decor };
    this.redraw();
  }

  /// Un foglio della pagina `geometry` fuori dalla vista, coi caratteri e i
  /// colori delle pagine e senza zoom: `measure` riempie e legge lo spazio fra
  /// i margini (l'indice, per sapere quante pagine prende), poi il foglio
  /// sparisce.
  measureSheet<T>(geometry: PrintLayout["page"], measure: (body: HTMLElement) => T): T {
    const page = document.createElement("div");
    page.className = "export-page";
    page.setAttribute("aria-hidden", "true");
    Object.assign(page.style, { width: `${geometry.width}px`, height: `${geometry.height}px`, visibility: "hidden", pointerEvents: "none" });
    const body = document.createElement("div");
    body.className = "export-page-body";
    Object.assign(body.style, {
      left: `${geometry.margin.left}px`,
      top: `${geometry.margin.top}px`,
      width: `${geometry.width - geometry.margin.left - geometry.margin.right}px`,
      height: `${geometry.height - geometry.margin.top - geometry.margin.bottom}px`,
    });
    page.append(body);
    this.element.append(page);
    try {
      return measure(body);
    } finally {
      page.remove();
    }
  }

  /// I fogli dell'impaginazione di adesso, quelli vicini pieni.
  private redraw(): void {
    const drawn = this.drawn;
    if (!drawn) return;
    const count = drawn.decor.sheets.length;
    while (this.slots.length > count) this.slots.pop()?.remove();
    while (this.slots.length < count) {
      const slot = this.emptySlot(this.slots.length);
      this.element.append(slot);
      this.slots.push(slot);
    }
    for (const [index, slot] of this.slots.entries()) this.markPickable(slot, index);
    for (const index of this.filled) this.clear(index);
    this.filled.clear();
    this.applyZoom();
    this.lastVisible = "";
    this.refresh();
  }

  setView(view: ExportView, free = this.free): number {
    this.view = view;
    this.free = free;
    this.element.dataset["view"] = view;
    for (const [index, slot] of this.slots.entries()) this.markPickable(slot, index);
    this.applyZoom();
    this.lastVisible = "";
    this.refresh();
    return this.zoomNow;
  }

  /// Porta la pagina `index` in cima al palco.
  reveal(index: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    this.stage.scrollTop = Math.max(0, slot.offsetTop - this.element.offsetTop);
    this.refresh();
  }

  /// Le pagine che si vedono adesso, dalla posizione dei fogli nel palco.
  visible(): VisiblePages {
    if (this.slots.length === 0) return { first: 0, last: 0 };
    const view = this.stage.getBoundingClientRect();
    let first = -1;
    let last = -1;
    for (const [index, slot] of this.slots.entries()) {
      const box = slot.getBoundingClientRect();
      if (box.bottom < view.top || box.top > view.bottom) {
        if (first >= 0) break;
        continue;
      }
      if (first < 0) first = index;
      last = index;
    }
    if (first < 0) return { first: 0, last: 0 };
    return { first, last };
  }

  /// Ogni pagina pronta, piena e senza zoom, per la stampa: i colori della
  /// carta viaggiano con lei, perché fuori dallo spazio non li eredita.
  printable(): HTMLElement[] {
    const drawn = this.drawn;
    if (!drawn) return [];
    const pages: HTMLElement[] = [];
    const count = Math.min(drawn.decor.front + Math.min(drawn.result.ready, drawn.result.pagination.pages.length), drawn.decor.sheets.length);
    for (let index = 0; index < count; index++) {
      const page = this.pageElement(drawn, index, 1, true);
      for (const [name, value] of Object.entries(this.colors)) page.style.setProperty(name, value);
      pages.push(page);
    }
    return pages;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.stage.removeEventListener("scroll", this.onScroll);
    this.element.remove();
    this.slots = [];
    this.filled.clear();
    this.drawn = null;
  }

  private relayoutZoom(): void {
    if (this.view === "libera") return;
    this.applyZoom();
    this.schedule();
  }

  private applyZoom(): void {
    const geometry = this.drawn?.layout.page;
    if (!geometry) return;
    const zoom = zoomFor(this.view, this.stage.clientWidth, geometry.width, this.free);
    this.zoomNow = zoom;
    for (const slot of this.slots) this.sizeSlot(slot, geometry.width, geometry.height, zoom);
  }

  private sizeSlot(slot: HTMLElement, width: number, height: number, zoom: number): void {
    slot.style.width = `${width * zoom}px`;
    slot.style.height = `${height * zoom}px`;
    const page = slot.firstElementChild as HTMLElement | null;
    if (page) page.style.transform = `scale(${zoom})`;
  }

  private emptySlot(index: number): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "export-slot";
    slot.dataset["page"] = String(index);
    this.markPickable(slot, index);
    const geometry = this.drawn?.layout.page;
    if (geometry) this.sizeSlot(slot, geometry.width, geometry.height, this.zoomNow);
    return slot;
  }

  /// Nella vista «tutte» ogni miniatura è un pulsante che porta alla sua
  /// pagina; nelle altre è un foglio e basta.
  private markPickable(slot: HTMLElement, index: number): void {
    const name = this.sheetName(index);
    if (this.view === "tutte") {
      slot.setAttribute("role", "button");
      slot.tabIndex = 0;
      slot.setAttribute("aria-label", t("pdf_export.page.open_named", { name }));
    } else {
      slot.removeAttribute("role");
      slot.removeAttribute("tabindex");
      slot.setAttribute("aria-label", name);
    }
  }

  /// Il nome di un foglio per chi ascolta: «Frontespizio», «Indice, pagina
  /// ii», «Pagina 3», col numero che il foglio porta.
  private sheetName(index: number): string {
    const sheet = this.drawn?.decor.sheets[index];
    if (sheet?.kind === "frontespizio") return t("pdf_export.page.cover");
    if (sheet?.kind === "indice") return t("pdf_export.page.toc", { n: sheet.number || String(index + 1) });
    return t("pdf_export.page.label", { n: sheet?.number || String(index + 1) });
  }

  private pick(event: Event): boolean {
    if (this.view !== "tutte") return false;
    const slot = (event.target as Element | null)?.closest<HTMLElement>(".export-slot");
    if (!slot || !this.element.contains(slot)) return false;
    this.options.onPick(Number(slot.dataset["page"]));
    return true;
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.refresh());
  }

  /// Riempie le pagine vicine a quelle che si vedono, svuota le lontane, e
  /// dice all'impaginatore dove si guarda.
  private refresh(): void {
    const drawn = this.drawn;
    if (!drawn) return;
    const visible = this.visible();
    const key = `${visible.first}:${visible.last}`;
    const { front } = drawn.decor;
    if (key !== this.lastVisible) {
      this.lastVisible = key;
      // L'impaginatore conta solo le pagine della nota.
      this.options.onVisible({ first: Math.max(0, visible.first - front), last: Math.max(0, visible.last - front) });
    }
    const from = Math.max(0, visible.first - FILL_MARGIN);
    const to = Math.min(this.slots.length - 1, visible.last + FILL_MARGIN, front + drawn.result.ready - 1);
    for (const index of [...this.filled]) {
      if (index < visible.first - KEEP_MARGIN || index > visible.last + KEEP_MARGIN) this.clear(index);
    }
    for (let index = from; index <= to; index++) {
      if (this.filled.has(index)) continue;
      const slot = this.slots[index];
      slot.replaceChildren(this.pageElement(drawn, index, this.zoomNow));
      this.filled.add(index);
    }
  }

  private clear(index: number): void {
    this.slots[index]?.replaceChildren();
    this.filled.delete(index);
  }

  /// Il foglio numero `index` (fra tutti), scalato a `zoom`; `print`: quello
  /// che va alla stampa, senza le guide.
  private pageElement(drawn: Drawn, index: number, zoom: number, print = false): HTMLElement {
    const { layout, result, blocks, decor } = drawn;
    const sheet = decor.sheets[index];
    const { page: geometry } = layout;
    const { width: columnWidth } = frameOf(layout);
    const gap = layout.columns === 2 ? layout.columnGap : 0;
    // Lo specchio sposta soltanto il testo: la colonna è larga uguale.
    const mirrored = this.marks.mirror && index % 2 === 1;
    const margin = mirrored ? { ...geometry.margin, left: geometry.margin.right, right: geometry.margin.left } : geometry.margin;
    const page = document.createElement("div");
    page.className = "export-page";
    page.style.width = `${geometry.width}px`;
    page.style.height = `${geometry.height}px`;
    page.style.transform = `scale(${zoom})`;
    if (this.marks.watermark.trim()) {
      const mark = document.createElement("div");
      mark.className = "export-watermark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = this.marks.watermark;
      page.append(mark);
    }
    const body = document.createElement("div");
    body.className = "export-page-body";
    body.style.left = `${margin.left}px`;
    body.style.top = `${margin.top}px`;
    body.style.width = `${geometry.width - margin.left - margin.right}px`;
    body.style.height = `${geometry.height - margin.top - margin.bottom}px`;
    page.append(body);
    if (!print) {
      // Le guide dei margini: i lati che si vedono su questo foglio (con lo
      // specchio la guida di sinistra è il margine destro del profilo, lo
      // sa `guides.ts`).
      page.style.setProperty("--export-margin-top", `${margin.top}px`);
      page.style.setProperty("--export-margin-right", `${margin.right}px`);
      page.style.setProperty("--export-margin-bottom", `${margin.bottom}px`);
      page.style.setProperty("--export-margin-left", `${margin.left}px`);
      for (const side of GUIDES) {
        const guide = document.createElement("i");
        guide.className = "export-guide";
        guide.dataset["guide"] = side;
        guide.setAttribute("aria-hidden", "true");
        page.append(guide);
      }
    }
    const placements = sheet?.kind === "pagina" ? (result.pagination.pages[sheet.index]?.placements ?? []) : [];
    const bands: { band: HTMLElement; inner: HTMLElement; copy: HTMLElement; placement: Placement }[] = [];
    for (const placement of placements) {
      // Le note dei commenti in fondo e il loro titolo le disegna la sezione
      // del contenuto (T74): qui solo le fasce dei blocchi.
      if (placement.box < 0 || (placement.part !== "corpo" && placement.part !== "intestazione")) continue;
      const block = blocks[result.blocks[placement.box] ?? -1];
      if (!block) continue;
      const band = document.createElement("div");
      band.className = "export-fascia";
      band.style.left = `${placement.column * (columnWidth + gap)}px`;
      band.style.top = `${placement.y}px`;
      band.style.width = `${columnWidth}px`;
      band.style.height = `${Math.max(0, (placement.to - placement.from) * placement.scale)}px`;
      const inner = document.createElement("div");
      inner.className = "export-fascia-content";
      inner.style.width = `${columnWidth}px`;
      const copy = copyInContext(block);
      inner.append(copy.root);
      band.append(inner);
      body.append(band);
      if (placement.scale < 1 && placement.part === "corpo" && !placement.continues) {
        const fit = document.createElement("span");
        fit.className = "export-fit";
        fit.textContent = t("pdf_export.page.fit");
        fit.style.left = band.style.left;
        fit.style.top = `${placement.y + (placement.to - placement.from) * placement.scale}px`;
        body.append(fit);
      }
      bands.push({ band, inner, copy: copy.block, placement });
    }
    if (sheet) decor.draw(page, body, sheet, index);
    // Dove sta il blocco copiato dentro i suoi contenitori si legge dopo
    // averli messi tutti (una sola disposizione), e solo se la pagina è
    // nel documento; fuori (la stampa) la copia sta in cima.
    const measure = () => {
      for (const { inner, copy, placement } of bands) {
        const offset = offsetWithin(copy, inner);
        inner.style.transform = `translateY(${-(offset + placement.from) * placement.scale}px) scale(${placement.scale})`;
      }
    };
    if (this.element.isConnected) {
      // Misurata appena entra: la pagina appena fatta non è ancora nel foglio.
      queueMicrotask(() => {
        if (page.isConnected) measure();
      });
    }
    measure();
    return page;
  }
}

/// Dove sta il bordo alto di `element` sotto il bordo alto di `container`, in
/// pixel senza zoom: la somma degli `offsetTop` fino al contenitore.
function offsetWithin(element: HTMLElement, container: HTMLElement): number {
  let offset = 0;
  let node: HTMLElement | null = element;
  while (node && node !== container) {
    offset += node.offsetTop;
    const parent: Element | null = node.offsetParent;
    if (!(parent instanceof HTMLElement) || !container.contains(parent)) break;
    node = parent;
  }
  return offset;
}

/// La copia di un blocco coi suoi contenitori della resa, dalla pagina di
/// stampa in giù: copie vuote dei contenitori, copia piena del blocco. Una
/// voce d'elenco numerato tiene il suo numero; gli `id` non si ripetono; le
/// tele copiano i loro pixel.
function copyInContext(block: HTMLElement): { root: HTMLElement; block: HTMLElement } {
  const copy = block.cloneNode(true) as HTMLElement;
  copyCanvases(block, copy);
  stripIds(copy);
  let root: HTMLElement = copy;
  let child: HTMLElement = block;
  let parent = block.parentElement;
  while (parent) {
    const shell = parent.cloneNode(false) as HTMLElement;
    shell.removeAttribute("id");
    if (shell instanceof HTMLOListElement && child instanceof HTMLLIElement) {
      const start = (parent as HTMLOListElement).start || 1;
      const position = [...parent.children].filter((node) => node instanceof HTMLLIElement).indexOf(child);
      shell.start = start + Math.max(0, position);
    }
    shell.append(root);
    root = shell;
    if (parent.classList.contains("print-page")) break;
    child = parent;
    parent = parent.parentElement;
  }
  return { root, block: copy };
}

function stripIds(element: HTMLElement): void {
  element.removeAttribute("id");
  for (const node of element.querySelectorAll("[id]")) node.removeAttribute("id");
}

function copyCanvases(from: HTMLElement, to: HTMLElement): void {
  const sources = from.querySelectorAll("canvas");
  if (sources.length === 0) return;
  const targets = to.querySelectorAll("canvas");
  sources.forEach((source, index) => {
    const target = targets[index];
    if (!target || source.width === 0 || source.height === 0) return;
    try {
      target.getContext("2d")?.drawImage(source, 0, 0);
    } catch {
      // Una tela che non si lascia leggere resta vuota: la pagina esce lo stesso.
    }
  });
}
