// La misura della resa per la stampa (E28, T69b): dai blocchi che il browser ha
// disposto alle scatole delle regole (`model.ts`, `rules.ts`).
//
// La resa per la stampa sta montata in un contenitore largo quanto la colonna
// del testo. Ogni blocco di primo livello (un titolo, un paragrafo, una voce
// d'elenco, una tabella, un blocco di codice, una figura) diventa una scatola,
// con la sua posizione nella resa: chi disegna la pagina sposta il blocco
// dalla sua `top` alla `y` della fascia che le regole gli danno.
//
// Due profondità di misura, perché una nota di 200 pagine non si misura riga
// per riga in un colpo solo:
// - `stima`: un rettangolo per blocco (e l'intestazione di una tabella); le
//   righe di un paragrafo sono stimate uguali, dall'interlinea. Per un
//   paragrafo di solo testo alto un multiplo esatto dell'interlinea la stima è
//   già la misura (`exact`), e la seconda passata non serve;
// - `righe`: i rettangoli di ogni riga del testo (o di ogni riga della
//   tabella), raggruppati per riga.
// Le due danno la stessa altezza totale: cambia solo dove una scatola si può
// spezzare. Così una pagina impaginata con le stime si sposta al più di una
// riga quando arrivano le righe vere.

import { MANUAL_BREAK_PREFIX } from "./breaks";
import type { FlowBox, HeadingBox } from "./model";

export type MeasureDepth = "stima" | "righe";

/// Un blocco misurato, nelle coordinate della resa: dal bordo alto del
/// contenitore. Lo spazio sopra la scatola (`gap`) lo calcola chi impagina,
/// dal bordo basso del blocco prima.
export interface MeasuredBlock {
  readonly box: FlowBox;
  readonly top: number;
  readonly bottom: number;
  /// Le righe sono quelle vere: misurare a fondo non cambierebbe niente.
  readonly exact: boolean;
}

/// Ciò che nella resa è un contenitore e non un blocco: ci si scende dentro.
const WRAPPERS = new Set(["print-page", "print-body", "markdown-rendered"]);

/// I blocchi che si spezzano fra le righe come un paragrafo.
const PARAGRAPHS = new Set(["P", "LI", "BLOCKQUOTE", "DL", "DD", "DT", "ADDRESS"]);

/// Ciò che dentro una riga di testo ha una sua altezza: un'immagine, una
/// formula, un disegno, una casella.
const ATOMIC = "img, svg, .katex, input, video, canvas, iframe";

/// Un paragrafo con dentro uno di questi non ha righe tutte uguali.
const IRREGULAR = `${ATOMIC}, p, ul, ol, pre, table, blockquote, div, figure, h1, h2, h3, h4, h5, h6, hr, br, sup, sub, code, kbd, big, small`;

/// L'identità di un blocco nella resa: la sua posizione nel sorgente, se la
/// resa la dice (la ritrovano l'indice e il clic sulla pagina), se no l'ordine.
/// La resa della Lettura la scrive in `data-md-from`, quella per la stampa
/// del core in byte in `data-fub-source-start` (`sourceSpanOf`): con lei
/// l'identità non dipende da quali blocchi sono nascosti.
export function blockId(element: Element, index: number): string {
  const from = (element as HTMLElement).dataset?.mdFrom;
  if (from !== undefined && /^\d+$/.test(from)) return `md:${from}`;
  const span = sourceSpanOf(element);
  if (span) return `src:${span.start}`;
  if (element instanceof HTMLHeadingElement && element.parentElement?.classList.contains("print-page")) return "titolo";
  return `blocco:${index}`;
}

/// Dove sta un blocco della resa per la stampa nel sorgente della nota, in
/// byte UTF-8 (`data-fub-source-start`/`-end` del core); per un contenitore
/// che la resa mette attorno a un blocco solo (lo scorrimento di una tabella)
/// quello del blocco dentro. `null` se la resa non lo dice: il titolo della
/// pagina, ciò che lo spazio aggiunge, un blocco di una nota trasclusa.
export function sourceSpanOf(element: Element): { readonly start: number; readonly end: number } | null {
  // Dentro una nota trasclusa le posizioni sono della nota trasclusa.
  const inner = element.children.length === 1 && !element.classList.contains("embed") ? element.firstElementChild : null;
  const own = element.hasAttribute("data-fub-source-start") ? element : inner;
  if (!own) return null;
  const start = own.getAttribute("data-fub-source-start") ?? "";
  const end = own.getAttribute("data-fub-source-end") ?? "";
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) return null;
  const span = { start: Number(start), end: Number(end) };
  return Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end) && span.start <= span.end ? span : null;
}

/// I blocchi di primo livello della resa, nell'ordine: si scende nei
/// contenitori della pagina di stampa e negli elenchi, una voce per scatola.
/// Ciò che non si vede (`display: none`, i blocchi lasciati fuori) non c'è.
export function printBlocks(root: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (parent: Element) => {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || child.hidden) continue;
      if ([...child.classList].some((name) => WRAPPERS.has(name)) || child.tagName === "UL" || child.tagName === "OL") {
        visit(child);
        continue;
      }
      out.push(child);
    }
  };
  visit(root);
  return out;
}

/// Misura i blocchi di una resa montata. Le posizioni sono prese rispetto al
/// bordo alto di `root` al momento della costruzione: fra una misura e l'altra
/// la resa non si sposta (sta in un contenitore fisso, fuori dalla vista).
export class PrintMeasure {
  readonly blocks: readonly HTMLElement[];
  private readonly origin: number;
  private readonly lineHeights = new Map<string, Omit<Grid, "pitch">>();
  private readonly range = document.createRange();

  constructor(root: HTMLElement) {
    this.blocks = printBlocks(root);
    this.origin = root.getBoundingClientRect().top;
  }

  get count(): number {
    return this.blocks.length;
  }

  measure(index: number, depth: MeasureDepth): MeasuredBlock {
    const element = this.blocks[index];
    const rect = element.getBoundingClientRect();
    const top = rect.top - this.origin;
    const bottom = rect.bottom - this.origin;
    const height = Math.max(0, bottom - top);
    const id = blockId(element, index);
    const tag = element.tagName;
    if (/^H[1-6]$/.test(tag)) {
      return { box: { kind: "heading", id, level: Number(tag[1]) as HeadingBox["level"], height }, top, bottom, exact: true };
    }
    if (tag === "HR") return { box: { kind: "separator", id, height }, top, bottom, exact: true };
    // `<!-- pagina -->` (D17): un separatore alto zero che volta sempre pagina
    // (`applyBreaks`).
    if (element.hasAttribute("data-page-break")) {
      return { box: { kind: "separator", id: `${MANUAL_BREAK_PREFIX}${id}`, height: 0 }, top, bottom: top, exact: true };
    }
    const table = tag === "TABLE" ? (element as HTMLTableElement) : element.querySelector(":scope > table");
    if (table instanceof HTMLTableElement && (tag === "TABLE" || element.children.length === 1)) {
      return { box: this.table(id, table, rect.top, height, depth), top, bottom, exact: depth === "righe" };
    }
    const code = tag === "PRE" && !element.hasAttribute("data-declared-fence");
    if (code || PARAGRAPHS.has(tag)) {
      const kind = code ? "code" : "paragraph";
      if (depth === "stima") {
        const { lines, exact } = this.estimateLines(element, height, code);
        return { box: { kind, id, lines }, top, bottom, exact };
      }
      return { box: { kind, id, lines: this.lines(element, rect.top, height) }, top, bottom, exact: true };
    }
    // Una figura, una formula, un riquadro, un diagramma: non si spezza.
    return { box: { kind: "block", id, height }, top, bottom, exact: true };
  }

  dispose(): void {
    this.range.detach();
  }

  /// Le righe uguali che l'interlinea fa stare fra il bordo e il riquadro
  /// interno del blocco: il bordo e lo spazio interno di sopra stanno nella
  /// prima, quelli di sotto nell'ultima. La stima è esatta per un blocco di
  /// solo testo alto un multiplo dell'interlinea: lì le righe sono quelle.
  private estimateLines(element: HTMLElement, height: number, code: boolean): { lines: number[]; exact: boolean } {
    const { grid, count, uniform } = this.grid(element, height);
    const lines = Array.from({ length: count }, () => grid.pitch);
    lines[0] += grid.before;
    lines[count - 1] += grid.after;
    // Nel codice i colori della sintassi non cambiano le righe: conta solo ciò
    // che ha un'altezza sua.
    const regular = code ? element.querySelector(ATOMIC) === null : textHost(element).querySelector(IRREGULAR) === null;
    return { lines, exact: uniform && regular };
  }

  /// La griglia delle righe di un blocco: interlinea, bordo e spazio interno.
  private grid(element: HTMLElement, height: number): { grid: Grid; count: number; uniform: boolean } {
    const metrics = this.metrics(element);
    const content = Math.max(0, height - metrics.before - metrics.after);
    const ratio = metrics.lineHeight > 0 ? content / metrics.lineHeight : 1;
    const count = Math.max(1, Math.round(ratio));
    return { grid: { ...metrics, pitch: content / count }, count, uniform: Math.abs(ratio - count) < 0.02 };
  }

  private metrics(element: HTMLElement): Omit<Grid, "pitch"> {
    const key = `${element.parentElement?.tagName ?? ""}>${element.tagName}.${element.className}`;
    const known = this.lineHeights.get(key);
    if (known !== undefined) return known;
    const style = getComputedStyle(element);
    const value = parseFloat(style.lineHeight);
    const px = (v: string) => parseFloat(v) || 0;
    const metrics = {
      lineHeight: Number.isFinite(value) && value > 0 ? value : (parseFloat(style.fontSize) || 16) * 1.2,
      before: px(style.paddingTop) + px(style.borderTopWidth),
      after: px(style.paddingBottom) + px(style.borderBottomWidth),
    };
    this.lineHeights.set(key, metrics);
    return metrics;
  }

  /// Le righe vere: i rettangoli del testo e di ciò che sta nella riga,
  /// raggruppati per riga. Ogni taglio cade fra il fondo di una riga e la cima
  /// della successiva: sul confine delle righe dell'interlinea se cade lì in
  /// mezzo (così un blocco di righe uguali dà le righe della stima), se no a
  /// metà. La prima riga comincia col blocco e l'ultima finisce con lui, così
  /// la somma è l'altezza del blocco.
  private lines(element: HTMLElement, top: number, height: number): number[] {
    const rows = lineRows(this.rects(element));
    return bandsOf(rows, top, height, this.grid(element, height).grid);
  }

  private rects(element: HTMLElement): { top: number; bottom: number }[] {
    const out: { top: number; bottom: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (!text.data.trim() && !text.data.includes("\n")) continue;
      // La copia MathML di una formula c'è per i lettori di schermo, non si vede.
      if (text.parentElement?.closest(".katex-mathml, .markdown-code-copy")) continue;
      this.range.selectNodeContents(text);
      for (const r of this.range.getClientRects()) if (r.height > 0) out.push({ top: r.top, bottom: r.bottom });
    }
    for (const atom of element.querySelectorAll(ATOMIC)) {
      if (atom.parentElement?.closest("svg, .katex")) continue;
      const r = atom.getBoundingClientRect();
      if (r.height > 0) out.push({ top: r.top, bottom: r.bottom });
    }
    return out;
  }

  /// Una tabella: l'intestazione e le righe del corpo. Con la stima, righe
  /// uguali; con le righe, la cima di ognuna.
  private table(id: string, table: HTMLTableElement, top: number, height: number, depth: MeasureDepth): FlowBox {
    const body = [...table.querySelectorAll(":scope > tbody > tr, :scope > tr")];
    const head = table.querySelector(":scope > thead");
    const hasHead = head !== null && head.querySelector("tr") !== null;
    const headerBottom = hasHead ? head.getBoundingClientRect().bottom : top;
    if (body.length === 0) return { kind: "table", id, header: height, rows: [] };
    if (depth === "stima") {
      const header = Math.min(height, Math.max(0, headerBottom - top));
      const each = (height - header) / body.length;
      return { kind: "table", id, header, rows: body.map(() => each) };
    }
    const starts = body.map((row) => row.getBoundingClientRect().top - top);
    const header = hasHead ? clamp(starts[0], 0, height) : 0;
    const rows = starts.map((start, k) => {
      const from = k === 0 ? header : clamp(start, header, height);
      const to = k + 1 < starts.length ? clamp(starts[k + 1], from, height) : height;
      return Math.max(0, to - from);
    });
    return { kind: "table", id, header, rows };
  }
}

/// Dove sta il testo di un blocco: una voce d'elenco «larga» lo tiene in un
/// paragrafo solo, che non cambia le righe.
function textHost(element: HTMLElement): Element {
  let host: Element = element;
  const ownText = (node: Element) => [...node.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
  while (host.children.length === 1 && host.firstElementChild?.tagName === "P" && !ownText(host)) host = host.firstElementChild;
  return host;
}

/// I rettangoli raggruppati per riga: due rettangoli stanno sulla stessa riga
/// se si sovrappongono per più di metà del più basso dei due (un esponente,
/// una formula in linea).
export function lineRows(rects: readonly { top: number; bottom: number }[]): { top: number; bottom: number }[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const rows: { top: number; bottom: number }[] = [];
  for (const r of sorted) {
    const last = rows[rows.length - 1];
    const overlap = last ? Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top) : -1;
    if (last && overlap > Math.min(last.bottom - last.top, r.bottom - r.top) / 2) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else rows.push({ top: r.top, bottom: r.bottom });
  }
  return rows;
}

/// La griglia delle righe di un blocco, dal suo bordo alto: `before` (il
/// bordo e lo spazio interno di sopra), poi una riga ogni `pitch`, poi
/// `after`. `lineHeight` è l'interlinea calcolata.
export interface Grid {
  readonly lineHeight: number;
  readonly before: number;
  readonly after: number;
  readonly pitch: number;
}

/// Dalle righe (nelle coordinate dello schermo) alle altezze delle fasce del
/// blocco che comincia in `top` ed è alto `height`. Il taglio fra due righe
/// cade a metà fra loro, o sul confine della griglia se sta fra le due: le
/// lettere non stanno al centro della loro riga (l'ascendente del carattere
/// non è il discendente), e il confine è dove la riga finisce davvero. Un
/// pixel di tolleranza, perché il riquadro di una lettera può uscire di poco
/// dalla sua riga senza che l'inchiostro lo faccia.
export function bandsOf(rows: readonly { top: number; bottom: number }[], top: number, height: number, grid?: Grid): number[] {
  if (rows.length === 0) return [height];
  const cuts = [0];
  for (let k = 1; k < rows.length; k++) {
    const above = Math.max(rows[k - 1].bottom - top, cuts[cuts.length - 1]);
    const below = rows[k].top - top;
    let cut = (above + below) / 2;
    if (grid && grid.pitch > 0) {
      const j = Math.round((cut - grid.before) / grid.pitch);
      const line = grid.before + j * grid.pitch;
      if (j > 0 && line >= above - 1 && line <= below + 1) cut = line;
    }
    cuts.push(clamp(cut, cuts[cuts.length - 1], height));
  }
  cuts.push(height);
  const bands: number[] = [];
  for (let k = 1; k < cuts.length; k++) bands.push(cuts[k] - cuts[k - 1]);
  return bands;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
