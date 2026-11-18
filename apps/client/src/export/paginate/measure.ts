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
export function blockId(element: Element, index: number): string {
  const from = (element as HTMLElement).dataset?.mdFrom;
  if (from !== undefined && /^\d+$/.test(from)) return `md:${from}`;
  if (element instanceof HTMLHeadingElement && element.parentElement?.classList.contains("print-page")) return "titolo";
  return `blocco:${index}`;
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
  private readonly lineHeights = new Map<string, number>();
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

  /// Le righe uguali che l'interlinea fa stare nel blocco. La stima è esatta
  /// per un paragrafo di solo testo alto un multiplo dell'interlinea.
  private estimateLines(element: HTMLElement, height: number, code: boolean): { lines: number[]; exact: boolean } {
    const lineHeight = this.lineHeight(element);
    const ratio = lineHeight > 0 ? height / lineHeight : 1;
    const count = Math.max(1, Math.round(ratio));
    const exact = !code && Math.abs(ratio - count) < 0.02 && textHost(element).querySelector(IRREGULAR) === null;
    return { lines: Array.from({ length: count }, () => height / count), exact };
  }

  private lineHeight(element: HTMLElement): number {
    const key = `${element.parentElement?.tagName ?? ""}>${element.tagName}.${element.className}`;
    const known = this.lineHeights.get(key);
    if (known !== undefined) return known;
    const style = getComputedStyle(element);
    const value = parseFloat(style.lineHeight);
    const lineHeight = Number.isFinite(value) && value > 0 ? value : (parseFloat(style.fontSize) || 16) * 1.2;
    this.lineHeights.set(key, lineHeight);
    return lineHeight;
  }

  /// Le righe vere: i rettangoli del testo e di ciò che sta nella riga,
  /// raggruppati per riga. Ogni taglio cade a metà fra il fondo di una riga e
  /// la cima della successiva; la prima riga comincia col blocco e l'ultima
  /// finisce con lui, così la somma è l'altezza del blocco.
  private lines(element: HTMLElement, top: number, height: number): number[] {
    const rows = lineRows(this.rects(element));
    return bandsOf(rows, top, height);
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

/// Dalle righe (nelle coordinate dello schermo) alle altezze delle fasce del
/// blocco che comincia in `top` ed è alto `height`.
export function bandsOf(rows: readonly { top: number; bottom: number }[], top: number, height: number): number[] {
  if (rows.length === 0) return [height];
  const cuts = [0];
  for (let k = 1; k < rows.length; k++) {
    const middle = (Math.max(rows[k - 1].bottom, cuts[cuts.length - 1] + top) + rows[k].top) / 2 - top;
    cuts.push(clamp(middle, cuts[cuts.length - 1], height));
  }
  cuts.push(height);
  const bands: number[] = [];
  for (let k = 1; k < cuts.length; k++) bands.push(cuts[k] - cuts[k - 1]);
  return bands;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
