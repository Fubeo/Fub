// La prova del motore del PDF (ADR 0247), dal lato della vista: una nota resa
// si impagina e se ne misura ciò che il browser ha disegnato, in un elenco di
// pagine che il core trasforma in PDF (`crates/fub-features/src/pdf_export`).
//
// La vista non manda la nota: manda il disegno. Ogni pezzo di testo su una
// riga con la sua linea di base, la sua faccia e la posizione di ogni lettera;
// i fondi e i bordi come riquadri; un SVG (un diagramma, la radice di una
// formula) come vettore, senza le sue scritte, che arrivano come testo; le
// immagini col loro file. Il core non va a capo e non impagina: mette ogni
// lettera dove la vista l'ha messa, e per questo anteprima e PDF coincidono
// sulla macchina che esporta.
//
// È una prova: l'impaginatore qui è il più semplice che regga (una riga che
// non sta va alla pagina dopo, un'immagine o un vettore interi alla pagina
// dopo, i fondi tagliati fra le due). Le regole vere sono di T69a e T69b.
//
// Ciò che la prova non sa ancora, e che l'ADR elenca: gli angoli arrotondati
// e i bordi tratteggiati escono pieni e dritti; un ripiego del browser su un
// carattere di sistema (una lettera fuori dal sottoinsieme latino) non si vede
// dal DOM; il grassetto finto di un carattere senza quel peso non c'è.

/// La pagina, in pixel CSS: 794×1123 è un A4 a 96 punti per pollice.
export interface PageGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
}

export const A4: PageGeometry = { width: 794, height: 1123, margin: { top: 72, right: 72, bottom: 72, left: 72 } };

/// Rosso, verde, blu da 0 a 255 e opacità da 0 a 1.
export type Color = [number, number, number, number];

export interface ProbeFace {
  readonly famiglia: string;
  readonly file: string;
  readonly corsivo: boolean;
  readonly assi: { readonly tag: string; readonly valore: number }[];
}

export type ProbeItem =
  | {
    readonly tipo: "testo";
    readonly x: number;
    readonly y: number;
    readonly larghezza: number;
    readonly faccia: number;
    readonly corpo: number;
    readonly colore: Color;
    readonly testo: string;
    readonly posizioni: number[];
    readonly sottolineato?: boolean;
    readonly barrato?: boolean;
  }
  | { readonly tipo: "riquadro"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly colore: Color }
  | { readonly tipo: "vettore"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly svg: string }
  | { readonly tipo: "immagine"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly file: string };

/// Il formato di `ElencoPagine` del core, versione 1.
export interface PageList {
  readonly versione: 1;
  readonly larghezza: number;
  readonly altezza: number;
  readonly titolo: string;
  readonly facce: ProbeFace[];
  readonly pagine: { pezzi: ProbeItem[] }[];
}

export interface ProbeMeasures {
  /// Quanto costa prendere dalla vista ciò che ha disegnato.
  readonly misuraMs: number;
  /// Quanto costa impaginare e scrivere il JSON.
  readonly impaginaMs: number;
  readonly pezzi: number;
  readonly lettere: number;
  readonly jsonByte: number;
  /// Il peso del JSON di ogni pagina da sola.
  readonly jsonBytePagina: number[];
}

export interface ProbeResult {
  readonly elenco: PageList;
  readonly misure: ProbeMeasures;
  /// Dove comincia ogni pagina, nella `y` della nota resa.
  readonly tagli: number[];
  /// Le lettere misurate, nell'ordine della nota, senza spazi: il termine di
  /// paragone del testo che si estrae dal PDF.
  readonly lettere: string;
}

/// Ciò che si misura prima di impaginare: le misure stanno nella `y` della
/// nota resa, con l'origine nel suo angolo in alto a sinistra.
export interface Measured {
  readonly item: ProbeItem;
  readonly top: number;
  readonly bottom: number;
  /// Un pezzo che non si spezza fra due pagine: una riga, un'immagine, un
  /// vettore. Un fondo si taglia.
  readonly whole: boolean;
}

interface Box { left: number; top: number; right: number; bottom: number }

const NOTHING: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

/// Il sottolineato e il barrato che un antenato mette sul testo: nel CSS non
/// si ereditano, si propagano, e lo stile calcolato del figlio non li dice.
interface Decor { readonly under: boolean; readonly strike: boolean }

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

export interface ProbeOptions {
  /// Il sorgente SVG di un'immagine che è un vettore (il diagramma che
  /// `mermaid.ts` mostra da un URL `blob:`): la CSP non lascia rileggere
  /// l'URL, lo sa chi l'ha creato. Senza, l'immagine passa come immagine.
  readonly vectorOf?: (img: HTMLImageElement) => string | null;
}

/// Misura la nota resa in `root` (larga quanto lo spazio fra i margini della
/// pagina) e la impagina in `page`.
export function measureNote(root: HTMLElement, page: PageGeometry = A4, title = "", options: ProbeOptions = {}): ProbeResult {
  const started = performance.now();
  const probe = new Probe(root, options);
  probe.element(root, NOTHING, { under: false, strike: false });
  probe.dispose();
  const measured = performance.now();
  const paged = paginate(probe.items, page);
  const pages = paged.pages;
  const list: PageList = {
    versione: 1,
    larghezza: page.width,
    altezza: page.height,
    titolo: title,
    facce: probe.faces.list,
    pagine: pages,
  };
  const json = JSON.stringify(list);
  const encoder = new TextEncoder();
  const misure: ProbeMeasures = {
    misuraMs: measured - started,
    impaginaMs: performance.now() - measured,
    pezzi: probe.items.length,
    lettere: probe.letters.length,
    jsonByte: encoder.encode(json).length,
    jsonBytePagina: pages.map((p) => encoder.encode(JSON.stringify(p)).length),
  };
  return { elenco: list, misure, tagli: paged.cuts, lettere: probe.letters };
}

class Probe {
  readonly items: Measured[] = [];
  readonly faces = new FaceTable();
  letters = "";
  private readonly origin: DOMRect;
  private readonly range = document.createRange();
  private readonly colors = new ColorReader();
  private readonly baselines = new BaselineReader();

  constructor(private readonly root: HTMLElement, private readonly options: ProbeOptions) {
    this.origin = root.getBoundingClientRect();
  }

  dispose(): void {
    this.range.detach();
    this.baselines.dispose();
  }

  element(el: Element, clip: Box, decor: Decor): void {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return;
    if (Number(style.opacity) === 0) return;
    const rect = el.getBoundingClientRect();
    const box = this.box(rect);
    if (el instanceof SVGSVGElement && !el.parentElement?.closest("svg")) {
      this.vector(el, box);
      // Le scritte del disegno arrivano come testo, sopra il vettore.
      this.svgText(el, intersect(clip, box), decor);
      return;
    }
    if (el instanceof HTMLImageElement) {
      this.image(el, box, clip);
      return;
    }
    if (el instanceof HTMLElement && el !== this.root) this.paint(style, box, clip);
    const lines = style.textDecorationLine;
    const inner: Decor = {
      under: decor.under || lines.includes("underline"),
      strike: decor.strike || lines.includes("line-through"),
    };
    const clips = style.overflowX !== "visible" || style.overflowY !== "visible";
    const innerClip = clips ? intersect(clip, box) : clip;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) this.text(child as Text, style, innerClip, inner);
      else if (child.nodeType === Node.ELEMENT_NODE) this.element(child as Element, innerClip, inner);
    }
  }

  /// Le scritte dentro un SVG: i `<text>` e l'HTML dei `<foreignObject>`.
  private svgText(svg: SVGSVGElement, clip: Box, decor: Decor): void {
    for (const node of svg.querySelectorAll("text, foreignObject")) {
      if (node.closest("defs, clipPath, mask, marker, symbol")) continue;
      if (node instanceof SVGForeignObjectElement) {
        for (const child of node.children) this.element(child, clip, decor);
        continue;
      }
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const parent = text.parentElement;
        if (parent) this.text(text as Text, getComputedStyle(parent), clip, decor);
      }
    }
  }

  private box(rect: DOMRect): Box {
    return {
      left: rect.left - this.origin.left,
      top: rect.top - this.origin.top,
      right: rect.right - this.origin.left,
      bottom: rect.bottom - this.origin.top,
    };
  }

  /// Il fondo e i quattro lati del bordo, come riquadri pieni.
  private paint(style: CSSStyleDeclaration, box: Box, clip: Box): void {
    const fill = this.colors.read(style.backgroundColor);
    if (fill[3] > 0) this.rect(intersect(box, clip), fill);
    const side = (width: string, kind: string, color: string, shape: (w: number) => Box) => {
      const w = parseFloat(width);
      if (!(w > 0) || kind === "none" || kind === "hidden") return;
      const c = this.colors.read(color);
      if (c[3] > 0) this.rect(intersect(shape(w), clip), c);
    };
    side(style.borderTopWidth, style.borderTopStyle, style.borderTopColor, (w) => ({ ...box, bottom: box.top + w }));
    side(style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor, (w) => ({ ...box, top: box.bottom - w }));
    side(style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor, (w) => ({ ...box, right: box.left + w }));
    side(style.borderRightWidth, style.borderRightStyle, style.borderRightColor, (w) => ({ ...box, left: box.right - w }));
  }

  private rect(box: Box, colore: Color): void {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    if (!(w > 0 && h > 0)) return;
    this.items.push({ item: { tipo: "riquadro", x: box.left, y: box.top, w, h, colore }, top: box.top, bottom: box.bottom, whole: false });
  }

  /// Un SVG come vettore: una copia senza scritte, con gli stili calcolati
  /// scritti sugli elementi, perché il CSS della pagina che lo veste non
  /// arriva al core.
  private vector(svg: SVGSVGElement, box: Box): void {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    if (!(w > 0 && h > 0)) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    const originals = [svg, ...svg.querySelectorAll("*")];
    const copies = [copy, ...copy.querySelectorAll("*")];
    originals.forEach((original, i) => {
      const target = copies[i];
      if (!(target instanceof SVGElement) || !(original instanceof SVGElement)) return;
      const s = getComputedStyle(original);
      for (const property of SVG_PAINT) {
        const value = s.getPropertyValue(property);
        if (value) target.style.setProperty(property, property === "fill" || property === "stroke" ? this.colors.css(value) : value);
      }
    });
    for (const node of copy.querySelectorAll("text, foreignObject, style")) node.remove();
    copy.setAttribute("width", String(w));
    copy.setAttribute("height", String(h));
    if (!copy.getAttribute("viewBox")) copy.setAttribute("viewBox", `0 0 ${w} ${h}`);
    copy.removeAttribute("style");
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const markup = new XMLSerializer().serializeToString(copy);
    this.items.push({ item: { tipo: "vettore", x: box.left, y: box.top, w, h, svg: markup }, top: box.top, bottom: box.bottom, whole: true });
  }

  private image(img: HTMLImageElement, box: Box, clip: Box): void {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    if (!(w > 0 && h > 0) || !img.complete || img.naturalWidth === 0) return;
    if (box.right <= clip.left || box.left >= clip.right || box.bottom <= clip.top || box.top >= clip.bottom) return;
    // Un SVG mostrato come immagine (un diagramma) resta un vettore, se chi
    // lo ha disegnato ne dà il sorgente: dall'`<img>` non si legge.
    const svg = this.options.vectorOf?.(img);
    if (svg) {
      this.items.push({ item: { tipo: "vettore", x: box.left, y: box.top, w, h, svg }, top: box.top, bottom: box.bottom, whole: true });
      return;
    }
    // Il file del vault, se la resa lo dice; se no l'indirizzo dell'immagine.
    const file = img.dataset.vaultId ?? img.currentSrc;
    this.items.push({ item: { tipo: "immagine", x: box.left, y: box.top, w, h, file }, top: box.top, bottom: box.bottom, whole: true });
  }

  /// Un nodo di testo, lettera per lettera: le lettere vicine sulla stessa
  /// riga fanno un pezzo, con la posizione di ognuna.
  private text(node: Text, style: CSSStyleDeclaration, clip: Box, decor: Decor): void {
    const data = node.data;
    if (!data.trim()) return;
    let face = -1;
    const size = parseFloat(style.fontSize);
    const color = this.colors.read(style.webkitTextFillColor || style.color);
    if (!(size > 0) || color[3] === 0) return;
    const ascent = this.baselines.ascent(style);
    const upper = style.textTransform === "uppercase";
    const lower = style.textTransform === "lowercase";
    let run: { top: number; bottom: number; x: number; right: number; text: string; at: number[] } | null = null;
    const flush = () => {
      if (!run) return;
      const visible = run.text.trim();
      if (visible) {
        this.letters += visible.replace(/\s+/gu, "");
        this.items.push({
          item: {
            tipo: "testo",
            x: run.x,
            y: run.top + ascent,
            larghezza: run.right - run.x,
            faccia: face < 0 ? (face = this.faces.index(style)) : face,
            corpo: size,
            colore: color,
            testo: run.text,
            posizioni: run.at,
            ...(decor.under ? { sottolineato: true } : {}),
            ...(decor.strike ? { barrato: true } : {}),
          },
          top: run.top,
          bottom: run.bottom,
          whole: true,
        });
      }
      run = null;
    };
    let offset = 0;
    for (const char of data) {
      const start = offset;
      offset += char.length;
      if (CONTROL.test(char)) continue;
      this.range.setStart(node, start);
      this.range.setEnd(node, offset);
      const rects = this.range.getClientRects();
      const r = rects[0];
      if (!r || (r.width === 0 && /\s/u.test(char))) {
        flush();
        continue;
      }
      const b = this.box(r);
      const midX = (b.left + b.right) / 2;
      const midY = (b.top + b.bottom) / 2;
      if (midX < clip.left || midX > clip.right || midY < clip.top || midY > clip.bottom) {
        flush();
        continue;
      }
      const shown = upper ? char.toUpperCase() : lower ? char.toLowerCase() : char;
      if ([...shown].length !== 1) {
        flush();
        continue;
      }
      if (run && Math.abs(b.top - run.top) < 0.5 && b.left >= run.right - 0.5 - size) {
        run.text += shown;
        run.at.push(round(b.left - run.x));
        run.right = Math.max(run.right, b.right);
      } else {
        flush();
        run = { top: b.top, bottom: b.bottom, x: b.left, right: b.right, text: shown, at: [0] };
      }
    }
    flush();
  }
}

/// Le proprietà della pittura di un SVG che il CSS della pagina può dare.
const SVG_PAINT = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
  "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "opacity", "display", "visibility",
] as const;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function intersect(a: Box, b: Box): Box {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

/// L'impaginatore della prova: una riga che non sta va alla pagina dopo,
/// un'immagine o un vettore che non stanno anche (se stanno in una pagina),
/// un fondo si taglia fra le pagine che attraversa.
export function paginate(items: Measured[], page: PageGeometry): { pages: { pezzi: ProbeItem[] }[]; cuts: number[] } {
  const height = page.height - page.margin.top - page.margin.bottom;
  const wholes = items.filter((m) => m.whole).sort((a, b) => a.top - b.top);
  const cuts = [0];
  for (const m of wholes) {
    let start = cuts[cuts.length - 1];
    while (m.bottom > start + height + 0.5) {
      const next = m.top > start + 0.5 && m.bottom - m.top <= height ? m.top : start + height;
      cuts.push(next);
      start = next;
    }
  }
  const pages = cuts.map(() => ({ pezzi: [] as ProbeItem[] }));
  const pageOf = (y: number) => {
    let k = 0;
    while (k + 1 < cuts.length && cuts[k + 1] <= y + 0.5) k++;
    return k;
  };
  const place = (item: ProbeItem, k: number) => {
    pages[k].pezzi.push({ ...item, x: round(item.x + page.margin.left), y: round(item.y - cuts[k] + page.margin.top) });
  };
  for (const m of items) {
    if (m.whole) {
      place(m.item, pageOf(m.top));
      continue;
    }
    // Un fondo, tagliato su ogni pagina che attraversa.
    const r = m.item as Extract<ProbeItem, { tipo: "riquadro" }>;
    for (let k = pageOf(r.y); k < cuts.length && cuts[k] < r.y + r.h; k++) {
      const from = Math.max(r.y, cuts[k]);
      const to = Math.min(r.y + r.h, cuts[k + 1] ?? Infinity, cuts[k] + height);
      if (to - from <= 0) continue;
      place({ ...r, y: from, h: round(to - from) }, k);
    }
  }
  return { pages, cuts };
}

/// Le facce dei caratteri della pagina: le regole `@font-face` dei fogli, e
/// quale file il browser ha preso per uno stile.
class FaceTable {
  readonly list: ProbeFace[] = [];
  private readonly keys = new Map<string, number>();
  private readonly rules = new Map<string, FontRule[]>();
  private readonly cache = new Map<string, number>();

  constructor() {
    const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])];
    for (const sheet of sheets) collectRules(sheet, this.rules);
  }

  index(style: CSSStyleDeclaration): number {
    const memo = [style.fontFamily, style.fontWeight, style.fontStyle, style.fontSize, style.fontVariationSettings, style.fontOpticalSizing].join("|");
    const known = this.cache.get(memo);
    if (known !== undefined) return known;
    const weight = Number(style.fontWeight) || 400;
    const italic = style.fontStyle !== "normal";
    const size = parseFloat(style.fontSize);
    let chosen: { family: string; rule: FontRule | null } | null = null;
    for (const family of style.fontFamily.split(",").map((f) => unquote(f.trim()))) {
      const rules = this.rules.get(family.toLowerCase());
      // Una famiglia con le sue regole ma col file non (ancora) caricato: il
      // browser ha disegnato con la successiva della pila.
      if (!rules || !document.fonts.check(`${italic ? "italic " : ""}${weight} ${size}px "${family}"`)) continue;
      chosen = { family, rule: pick(rules, weight, italic) };
      break;
    }
    const family = chosen?.family ?? style.fontFamily;
    const rule = chosen?.rule ?? null;
    const axes = new Map<string, number>();
    if (rule && rule.weight[0] !== rule.weight[1]) axes.set("wght", Math.min(rule.weight[1], Math.max(rule.weight[0], weight)));
    if (style.fontOpticalSizing !== "none") axes.set("opsz", size);
    for (const [, tag, value] of style.fontVariationSettings.matchAll(/["']([a-zA-Z0-9 ]{4})["']\s+(-?[\d.]+)/gu)) {
      axes.set(tag, Number(value));
    }
    const face: ProbeFace = {
      famiglia: family,
      file: rule?.file ?? "",
      corsivo: italic,
      assi: [...axes].sort(([a], [b]) => a.localeCompare(b)).map(([tag, valore]) => ({ tag, valore: round(valore) })),
    };
    const key = JSON.stringify(face);
    let index = this.keys.get(key);
    if (index === undefined) {
      index = this.list.length;
      this.list.push(face);
      this.keys.set(key, index);
    }
    this.cache.set(memo, index);
    return index;
  }
}

interface FontRule { readonly italic: boolean; readonly weight: [number, number]; readonly file: string }

function collectRules(sheet: CSSStyleSheet, into: Map<string, FontRule[]>): void {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return;
  }
  for (const rule of rules) {
    if (rule instanceof CSSImportRule && rule.styleSheet) collectRules(rule.styleSheet, into);
    if (!(rule instanceof CSSFontFaceRule)) continue;
    const family = unquote(rule.style.getPropertyValue("font-family")).toLowerCase();
    const url = /url\(\s*["']?([^"')]+)["']?\s*\)/u.exec(rule.style.getPropertyValue("src"))?.[1];
    if (!family || !url) continue;
    const base = sheet.href ?? location.href;
    const file = new URL(url, base).pathname;
    const weights = rule.style.getPropertyValue("font-weight").split(/\s+/u).map(Number).filter((n) => n > 0);
    const weight: [number, number] = weights.length === 0 ? [400, 400] : [weights[0], weights[weights.length - 1]];
    const italic = /italic|oblique/u.test(rule.style.getPropertyValue("font-style"));
    const list = into.get(family) ?? [];
    list.push({ italic, weight, file });
    into.set(family, list);
  }
}

/// La regola che il CSS sceglierebbe: lo stile, poi il peso più vicino.
function pick(rules: FontRule[], weight: number, italic: boolean): FontRule {
  const styled = rules.filter((r) => r.italic === italic);
  const pool = styled.length > 0 ? styled : rules;
  const distance = (r: FontRule) => (weight < r.weight[0] ? r.weight[0] - weight : weight > r.weight[1] ? weight - r.weight[1] : 0);
  return pool.reduce((best, r) => (distance(r) < distance(best) ? r : best));
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/gu, "");
}

/// I colori calcolati in RGBA: il browser li dice in molti modi (`rgb()`,
/// `oklch()`, `color(srgb …)`), una tela li riporta tutti in sRGB.
class ColorReader {
  private readonly cache = new Map<string, Color>();
  private readonly context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  read(value: string): Color {
    const known = this.cache.get(value);
    if (known) return known;
    let color: Color = [0, 0, 0, 1];
    const plain = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/u.exec(value);
    if (value === "transparent") color = [0, 0, 0, 0];
    else if (plain) {
      const alpha = plain[4] === undefined ? 1 : plain[4].endsWith("%") ? parseFloat(plain[4]) / 100 : Number(plain[4]);
      color = [Number(plain[1]), Number(plain[2]), Number(plain[3]), alpha];
    } else if (this.context) {
      this.context.clearRect(0, 0, 1, 1);
      this.context.fillStyle = value;
      this.context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = this.context.getImageData(0, 0, 1, 1).data;
      color = a === 0 ? [0, 0, 0, 0] : [Math.round((r * 255) / a), Math.round((g * 255) / a), Math.round((b * 255) / a), round(a / 255)];
      color = [Math.min(255, color[0]), Math.min(255, color[1]), Math.min(255, color[2]), color[3]];
    }
    this.cache.set(value, color);
    return color;
  }

  /// Lo stesso colore scritto come lo legge `usvg`.
  css(value: string): string {
    if (value === "none" || value.startsWith("url(")) return value;
    const [r, g, b, a] = this.read(value);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
}

/// Dove sta la linea di base sotto il bordo alto di una lettera: dipende solo
/// dal carattere e dal corpo, e la si misura una volta per stile.
class BaselineReader {
  private readonly cache = new Map<string, number>();
  private readonly host = document.createElement("div");

  constructor() {
    this.host.setAttribute("aria-hidden", "true");
    Object.assign(this.host.style, { position: "absolute", left: "-10000px", top: "0", visibility: "hidden", whiteSpace: "nowrap" });
    document.body.append(this.host);
  }

  ascent(style: CSSStyleDeclaration): number {
    const key = [style.fontFamily, style.fontWeight, style.fontStyle, style.fontSize, style.fontVariationSettings, style.fontOpticalSizing, style.fontStretch].join("|");
    const known = this.cache.get(key);
    if (known !== undefined) return known;
    const line = document.createElement("span");
    Object.assign(line.style, {
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontSize: style.fontSize,
      fontStretch: style.fontStretch,
      fontVariationSettings: style.fontVariationSettings,
      fontOpticalSizing: style.fontOpticalSizing,
      lineHeight: "normal",
    });
    const text = document.createTextNode("x");
    const mark = document.createElement("span");
    Object.assign(mark.style, { display: "inline-block", width: "0", height: "0", verticalAlign: "baseline" });
    line.append(text, mark);
    this.host.append(line);
    const range = document.createRange();
    range.selectNodeContents(text);
    const ascent = mark.getBoundingClientRect().bottom - range.getBoundingClientRect().top;
    range.detach();
    line.remove();
    this.cache.set(key, ascent);
    return ascent;
  }

  dispose(): void {
    this.host.remove();
  }
}
