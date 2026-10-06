// L'analisi della scena per l'indice (formato della scena, §9) e i controlli
// di §12 che non dipendono dalla classificazione.
//
// È `analysis.rs` di `fub-scene`. Due parti. [`index`] legge il documento
// intero, modificabile o estraneo: titolo, descrizione, testi, collegamenti e
// immagini del vault, con gli span; un disegno di Inkscape si cerca per i suoi
// testi anche se FubDraw non li modifica. Trova anche S001, S005 e S006.
// [`Tally`] invece segue la classificazione, che gli passa ogni elemento
// modificabile con il contesto ereditato dai contenitori: ne escono il
// riepilogo di `fub.scene.summary` e S009, che riguardano la scena come la
// modifica FubDraw.

import { diagnostic, type Diagnostic } from "./diagnostics";
import { BoundsBuilder, fmax, fmin, parsePath, rectPath } from "./geometry";
import { apply, compose, IDENTITY, type Matrix, type Point } from "./matrix";
import type { Span } from "./text";
import { href, isJavascript, length, opacity, paint, points, transform, trim, type Paint, type Rgb } from "./values";
import {
  attrOf,
  isSvg,
  NS_FUB,
  NS_NONE,
  NS_SVG,
  NS_XHTML,
  NS_XLINK,
  valueOf,
  type Attr,
  type ElementNode,
  type NodeId,
  type XmlDocument,
} from "./xml";

/// Quanti byte decodificati può avere un'immagine incorporata (§11).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/// Il contrasto minimo fra un tratto e la carta (§12).
export const MIN_CONTRAST = 3;

/// Che cosa rappresenta un elemento modificabile (§4). `ngon` e `star` sono il
/// poligono regolare e la stella sintetici, un `path` con `fub:shape` (§6);
/// `polygon` è l'elemento `polygon`.
export type Role =
  | "title"
  | "desc"
  | "paper"
  | "layer"
  | "group"
  | "link"
  | "stroke"
  | "arrow"
  | "ngon"
  | "star"
  | "path"
  | "rect"
  | "ellipse"
  | "circle"
  | "line"
  | "polyline"
  | "polygon"
  | "text"
  | "image";

/// Vero per i ruoli i cui figli si classificano uno per uno.
export function isContainer(role: Role): boolean {
  return role === "layer" || role === "group" || role === "link";
}

/// Lo strumento di un tratto.
export type Tool = "pen" | "highlighter";

/// Un tratto a mano libera.
export interface Stroke {
  readonly tool: Tool;
  /// Vero se `fub:ink` e `fub:brush` si leggono e l'inchiostro non ha canali
  /// sconosciuti: la superficie può ricalcolare `d`. Altrimenti il tratto si
  /// sposta, si trasforma, si ricolora e si elimina, e `d` resta com'è (S004,
  /// S010).
  readonly redrawable: boolean;
  /// I campioni di `fub:ink`, se si legge.
  readonly samples?: number;
  /// La durata in millisecondi, se `fub:ink` si legge e ha il canale `t`.
  readonly duration?: number;
}

/// Un testo della scena e l'elemento da cui viene.
export interface Excerpt extends Span {
  /// Il testo con gli spazi come li disegna SVG: ogni sequenza di spazi XML
  /// ridotta a uno, niente spazi ai bordi.
  readonly text: string;
}

/// Un riferimento a un documento del vault: un collegamento o un'immagine.
export interface Reference extends Span {
  /// Il percorso com'è scritto, ripulito come lo legge un URL: relativo al
  /// disegno, o dalla radice del vault se comincia con `/`.
  readonly path: string;
  /// Il valore grezzo dell'attributo, virgolette escluse: è ciò che si
  /// riscrive quando la destinazione cambia nome.
  readonly href: Span;
}

/// Ciò che l'indice legge di una scena (§9).
export interface Index {
  /// Il primo `title` figlio della radice, se ha del testo.
  readonly title: Excerpt | null;
  /// Il primo `desc` figlio della radice, se ha del testo.
  readonly desc: Excerpt | null;
  /// Ogni `text` con del testo, in ordine di documento: un paragrafo con le
  /// righe unite da uno spazio.
  readonly texts: readonly Excerpt[];
  /// Ogni `a` con un `href` verso il vault.
  readonly links: readonly Reference[];
  /// Ogni `image` con un percorso del vault.
  readonly embeds: readonly Reference[];
}

/// Quanti oggetti modificabili ha la scena, per tipo.
export interface Counts {
  strokes: number;
  /// Frecce, poligoni regolari, stelle, tracciati, rettangoli, ellissi,
  /// cerchi, linee, polilinee e poligoni; la carta no.
  shapes: number;
  texts: number;
  images: number;
  links: number;
  /// I blocchi estranei, anche quelli fuori dalla radice.
  foreign: number;
}

/// L'inchiostro dei tratti che si leggono.
export interface InkTotals {
  samples: number;
  /// La somma delle durate dei tratti, in millisecondi.
  duration: number;
}

/// Un rettangolo in coordinate della radice, coi bordi arrotondati ai
/// centesimi con la regola di §7.
export interface BBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Gli `attrs` del `block-custom` `fub.scene.summary` (§9).
export interface Summary {
  /// `fub:version`, se è un intero valido.
  readonly version: number | null;
  /// Vero per un documento senza `fub:version`.
  readonly foreign: boolean;
  /// Vero se il file supera il limite di §11.
  readonly truncated: boolean;
  /// I nomi dei livelli, in ordine di documento.
  readonly layers: readonly string[];
  readonly counts: Readonly<Counts>;
  readonly ink: Readonly<InkTotals>;
  /// Il rettangolo che contiene gli elementi modificabili visibili, dopo ogni
  /// `transform`; `null` se non ce n'è nessuno.
  readonly bbox: BBox | null;
}

/// `i64::MAX`, dove Rust satura la durata totale. Un `number` lo arrotonda a
/// 2⁶³, e una somma oltre 2⁵³ non è più esatta: lì i due lati possono
/// differire nelle ultime cifre. Ci arriva solo un file costruito apposta,
/// perché un giorno intero sono 8,64 · 10⁷ millisecondi.
const I64_MAX = 2 ** 63;

/// Quello che un contenitore modificabile trasmette ai figli.
export class Context {
  private constructor(
    /// Dalle coordinate locali a quelle della radice.
    readonly matrix: Matrix,
    /// Un antenato ha `display="none"`.
    readonly hidden: boolean,
    /// Il `fill` in vigore; `null` se la radice ne ha uno che §4 non legge.
    private readonly fillPaint: Paint | null,
    /// Il `fill-opacity` in vigore, come `fill`.
    private readonly fillOpacity: number | null,
    /// Il prodotto delle `opacity` dei contenitori.
    private readonly opacity: number,
  ) {}

  /// Il contesto dei figli della radice. Della radice contano solo `fill` e
  /// `fill-opacity`, che si ereditano.
  static root(root: ElementNode): Context {
    const fill = valueOf(root, NS_NONE, "fill");
    const alpha = valueOf(root, NS_NONE, "fill-opacity");
    return new Context(
      IDENTITY,
      false,
      fill === undefined ? [0, 0, 0] : paint(fill),
      alpha === undefined ? 1 : opacity(alpha),
      1,
    );
  }

  /// Il contesto di `element`, un elemento modificabile: i suoi valori
  /// rispettano già §4.
  child(element: ElementNode): Context {
    const value = (name: string): string | undefined => valueOf(element, NS_NONE, name);
    let matrix = this.matrix;
    const transformed = value("transform");
    const m = transformed === undefined ? null : transform(transformed);
    if (m !== null) matrix = compose(matrix, m);
    const display = value("display");
    const hidden = this.hidden || (display !== undefined && trim(display) === "none");
    const fill = value("fill");
    const alpha = value("fill-opacity");
    const groupAlpha = value("opacity");
    const group = groupAlpha === undefined ? null : opacity(groupAlpha);
    return new Context(
      matrix,
      hidden,
      fill === undefined ? this.fillPaint : paint(fill),
      alpha === undefined ? this.fillOpacity : opacity(alpha),
      group === null ? this.opacity : this.opacity * group,
    );
  }

  /// Il colore del riempimento con la sua opacità totale; `null` se non si
  /// sa o se è `none`.
  fill(): [Rgb, number] | null {
    if (this.fillPaint === null || this.fillOpacity === null || this.fillPaint === "none") return null;
    return [this.fillPaint, this.fillOpacity * this.opacity];
  }

  /// Il colore della carta sul bianco della superficie; `null` se non si sa.
  paperColor(): Rgb | null {
    if (this.hidden) return WHITE;
    if (this.fillPaint === null || this.fillOpacity === null) return null;
    if (this.fillPaint === "none") return WHITE;
    return over(this.fillPaint, this.fillOpacity * this.opacity, WHITE);
  }
}

export const WHITE: Rgb = [255, 255, 255];

/// `f64::round`: la metà si allontana dallo zero, non va verso +∞ come
/// `Math.round`.
function rustRound(v: number): number {
  const t = Math.trunc(v);
  return Math.abs(v - t) >= 0.5 ? t + Math.sign(v) : t;
}

/// `rgb` con opacità `alpha` composto su `under`, in sRGB come fanno i
/// browser, arrotondato al canale intero.
export function over(rgb: Rgb, alpha: number, under: Rgb): Rgb {
  const mix = (i: 0 | 1 | 2): number => {
    const v = alpha * rgb[i] + (1 - alpha) * under[i];
    // `round().clamp(0, 255) as u8`: un `NaN` diventa 0.
    const clamped = fmin(fmax(rustRound(v), 0), 255);
    return Number.isNaN(clamped) ? 0 : clamped;
  };
  return [mix(0), mix(1), mix(2)];
}

/// La luminanza relativa di WCAG, con la soglia di sRGB.
function luminance(rgb: Rgb): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/// Il rapporto di contrasto di WCAG fra due colori, da 1 a 21.
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (fmax(la, lb) + 0.05) / (fmin(la, lb) + 0.05);
}

/// `floor(v × 100 + 0,5)`: i centesimi di `v`, interi, con la regola di §7.
export function hundredths(v: number): number {
  return Math.floor(v * 100 + 0.5);
}

/// Il riepilogo che si accumula durante la classificazione.
export class Tally {
  private readonly layers: string[] = [];
  private readonly counts: Counts = { strokes: 0, shapes: 0, texts: 0, images: 0, links: 0, foreign: 0 };
  private readonly ink: InkTotals = { samples: 0, duration: 0 };
  private readonly bounds = new BoundsBuilder();
  /// Il colore della prima carta: `undefined` senza carta, `null` se non si
  /// sa.
  private paper: Rgb | null | undefined = undefined;
  /// I tratti a penna col loro colore, da confrontare con la carta alla
  /// fine: la carta può venire dopo.
  private readonly pens: Array<[Span, [Rgb, number]]> = [];

  /// Conta un blocco estraneo.
  foreign(): void {
    this.counts.foreign++;
  }

  /// Conta un elemento modificabile. `context` è quello dell'elemento, con i
  /// suoi attributi già applicati.
  element(
    doc: XmlDocument,
    element: ElementNode,
    role: Role,
    context: Context,
    span: Span,
    stroke: Stroke | null,
  ): void {
    switch (role) {
      case "layer":
        this.layers.push(valueOf(element, NS_FUB, "layer") ?? "");
        break;
      case "paper":
        if (this.paper === undefined) this.paper = context.paperColor();
        return;
      case "stroke":
        this.counts.strokes++;
        if (stroke !== null) {
          this.ink.samples += stroke.samples ?? 0;
          const duration = Math.max(stroke.duration ?? 0, 0);
          // `saturating_add` su `i64`.
          this.ink.duration = Math.min(this.ink.duration + duration, I64_MAX);
          if (stroke.tool === "pen") {
            const fill = context.fill();
            if (fill !== null) this.pens.push([span, fill]);
          }
        }
        break;
      case "arrow":
      case "ngon":
      case "star":
      case "path":
      case "rect":
      case "ellipse":
      case "circle":
      case "line":
      case "polyline":
      case "polygon":
        this.counts.shapes++;
        break;
      case "text":
        this.counts.texts++;
        break;
      case "image":
        this.counts.images++;
        break;
      case "link":
        this.counts.links++;
        break;
      default:
        break;
    }
    if (!context.hidden) bounds(doc, element, role, context.matrix, this.bounds);
  }

  /// Chiude il conteggio: il riepilogo, più S009 per ogni tratto a penna
  /// che contrasta poco con la carta.
  finish(foreign: boolean, version: number | null, diagnostics: Diagnostic[]): Summary {
    // Senza carta il disegno sta sul bianco della superficie (§12).
    const paper = this.paper === undefined ? WHITE : this.paper;
    if (paper !== null) {
      for (const [span, [rgb, alpha]] of this.pens) {
        const ratio = contrast(over(rgb, alpha, paper), paper);
        if (ratio < MIN_CONTRAST) {
          // Troncato, non arrotondato: 2,996 non deve leggersi «3.00».
          const shown = Math.floor(ratio * 100) / 100;
          diagnostics.push(diagnostic("S009", span, shown.toFixed(2)));
        }
      }
    }
    const b = this.bounds.finish();
    let bbox: BBox | null = null;
    if (b !== null) {
      const [x1, y1, x2, y2] = [b.min[0], b.min[1], b.max[0], b.max[1]].map(hundredths) as [
        number,
        number,
        number,
        number,
      ];
      const box = { x: x1 / 100, y: y1 / 100, width: (x2 - x1) / 100, height: (y2 - y1) / 100 };
      if ([box.x, box.y, box.width, box.height].every(Number.isFinite)) bbox = box;
    }
    return {
      version,
      foreign,
      truncated: false,
      layers: this.layers,
      counts: this.counts,
      ink: this.ink,
      bbox,
    };
  }
}

/// Il riepilogo di un file troncato: della testa si sa solo chi è.
export function truncatedSummary(foreign: boolean, version: number | null): Summary {
  return {
    version,
    foreign,
    truncated: true,
    layers: [],
    counts: { strokes: 0, shapes: 0, texts: 0, images: 0, links: 0, foreign: 0 },
    ink: { samples: 0, duration: 0 },
    bbox: null,
  };
}

/// Una lunghezza di `element`, già validata da §4.
function len(element: ElementNode, name: string): number | null {
  const value = valueOf(element, NS_NONE, name);
  return value === undefined ? null : length(value);
}

/// I raggi di un'ellisse o degli angoli di un rettangolo: in SVG 2 un raggio
/// assente vale l'altro.
function radii(element: ElementNode): Point {
  const rx = len(element, "rx");
  const ry = len(element, "ry");
  if (rx !== null && ry !== null) return [rx, ry];
  if (rx !== null) return [rx, rx];
  if (ry !== null) return [ry, ry];
  return [0, 0];
}

/// Aggiunge a `out` la geometria di `element` trasformata da `m`: quella che
/// `getBBox` misura, senza lo spessore del contorno.
function bounds(doc: XmlDocument, element: ElementNode, role: Role, m: Matrix, out: BoundsBuilder): void {
  const at = (name: string): number => len(element, name) ?? 0;
  switch (role) {
    case "stroke":
    case "arrow":
    case "ngon":
    case "star":
    case "path": {
      const d = valueOf(element, NS_NONE, "d");
      const segments = d === undefined ? null : parsePath(d);
      if (segments !== null) out.path(segments, m);
      break;
    }
    case "rect": {
      const [rx, ry] = radii(element);
      out.path(rectPath(at("x"), at("y"), at("width"), at("height"), rx, ry), m);
      break;
    }
    case "image":
      // Senza `width` e `height` l'immagine prende le sue dimensioni, che
      // qui non si conoscono: conta il suo angolo.
      out.path(rectPath(at("x"), at("y"), at("width"), at("height"), 0, 0), m);
      break;
    case "ellipse":
      out.ellipse([at("cx"), at("cy")], radii(element), m);
      break;
    case "circle":
      out.ellipse([at("cx"), at("cy")], [at("r"), at("r")], m);
      break;
    case "line":
      out.include(apply(m, [at("x1"), at("y1")]));
      out.include(apply(m, [at("x2"), at("y2")]));
      break;
    case "polyline":
    case "polygon": {
      const value = valueOf(element, NS_NONE, "points");
      for (const p of (value === undefined ? null : points(value)) ?? []) out.include(apply(m, p));
      break;
    }
    case "text": {
      // L'ingombro di un testo dipende dai caratteri, che qui non ci sono:
      // contano i punti d'inizio delle righe, un `tspan` per riga.
      const x = at("x");
      let y = at("y");
      out.include(apply(m, [x, y]));
      for (const child of element.children) {
        const tspan = doc.element(child);
        if (tspan === null || !isSvg(tspan, "tspan")) continue;
        y += len(tspan, "dy") ?? 0;
        out.include(apply(m, [len(tspan, "x") ?? x, y]));
      }
      break;
    }
    default:
      break;
  }
}

/// Vero per gli elementi SVG che dentro un testo non si disegnano: i
/// metadati e un `text` annidato.
function unrendered(element: ElementNode): boolean {
  return element.ns === NS_SVG
    && (element.local === "title" || element.local === "desc" || element.local === "metadata" || element.local === "text");
}

/// Accoda a `out` il testo di `id` e dei suoi discendenti, in ordine: dati di
/// carattere, CDATA e le entità che sono testo semplice. Una pila, non la
/// ricorsione: un `tspan` può annidarne centomila.
function textContent(doc: XmlDocument, id: NodeId, out: string[]): void {
  const stack: Array<[NodeId, number]> = [[id, 0]];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const children = doc.children(frame[0]);
    const child = children[frame[1]];
    if (child === undefined) {
      stack.pop();
      continue;
    }
    frame[1]++;
    const node = doc.nodes[child]!;
    switch (node.kind) {
      case "text":
      case "cdata":
        out.push(node.value);
        break;
      case "entity-ref":
        out.push(doc.plainEntity(node.name) ?? "");
        break;
      case "element":
        if (!unrendered(node)) stack.push([child, 0]);
        break;
      default:
        break;
    }
  }
}

/// Riduce ogni sequenza di spazi XML a uno spazio e toglie quelli ai bordi.
export function collapse(text: string): string {
  return text.split(/[ \t\n\r]/).filter((word) => word !== "").join(" ");
}

/// Il paragrafo di un `text`: ogni figlio elemento è una riga, e i dati di
/// carattere fra due figli ne sono un'altra. Le righe si uniscono con uno
/// spazio.
function paragraph(doc: XmlDocument, id: NodeId): string {
  const lines: string[] = [];
  let run: string[] = [];
  for (const child of doc.children(id)) {
    const node = doc.nodes[child]!;
    switch (node.kind) {
      case "text":
      case "cdata":
        run.push(node.value);
        break;
      case "entity-ref":
        run.push(doc.plainEntity(node.name) ?? "");
        break;
      case "element":
        if (!unrendered(node)) {
          lines.push(collapse(run.join("")));
          run = [];
          const line: string[] = [];
          textContent(doc, child, line);
          lines.push(collapse(line.join("")));
        }
        break;
      default:
        break;
    }
  }
  lines.push(collapse(run.join("")));
  return lines.filter((line) => line !== "").join(" ");
}

/// L'`href` di un elemento: in SVG 2 `href` vince su `xlink:href`.
function hrefAttr(element: ElementNode): Attr | undefined {
  return attrOf(element, NS_NONE, "href") ?? attrOf(element, NS_XLINK, "href");
}

/// Il contenuto attivo di un elemento (S005): il nome del motivo per ognuno.
function activeContent(element: ElementNode): string[] {
  const found: string[] = [];
  if (element.local === "script" && (element.ns === NS_SVG || element.ns === NS_XHTML)) found.push("script");
  // Un'animazione che porta `href` su `javascript:` vale l'`href` stesso.
  const attributeName = valueOf(element, NS_NONE, "attributeName");
  const animatesHref = element.ns === NS_SVG
    && (element.local === "set" || element.local === "animate")
    && attributeName !== undefined
    && (trim(attributeName) === "href" || trim(attributeName) === "xlink:href");
  for (const attr of element.attrs) {
    const handler = attr.ns === NS_NONE
      && attr.local.length > 2
      && (attr.local.charCodeAt(0) | 0x20) === 0x6f
      && (attr.local.charCodeAt(1) | 0x20) === 0x6e;
    let javascript = false;
    if ((attr.ns === NS_NONE || attr.ns === NS_XLINK) && attr.local === "href") {
      javascript = isJavascript(attr.value);
    } else if (attr.ns === NS_NONE && animatesHref) {
      if (attr.local === "to" || attr.local === "from" || attr.local === "by") javascript = isJavascript(attr.value);
      else if (attr.local === "values") javascript = attr.value.split(";").some(isJavascript);
    }
    if (handler || javascript) found.push(attr.name);
  }
  return found;
}

/// Legge l'indice del documento, con S001, S005 e S006.
export function index(doc: XmlDocument, diagnostics: Diagnostic[]): Index {
  const source = doc.source;
  const span = (id: NodeId): Span => {
    const node = doc.nodes[id]!;
    return source.span(node.start, node.end);
  };
  const excerpt = (id: NodeId): Excerpt => {
    const text: string[] = [];
    textContent(doc, id, text);
    return { text: collapse(text.join("")), ...span(id) };
  };
  // Il titolo e la descrizione: i primi figli della radice con quel nome.
  const first = (local: string): NodeId | undefined =>
    doc.children(doc.root).find((child) => {
      const element = doc.element(child);
      return element !== null && isSvg(element, local);
    });
  const titleId = first("title");
  const title = titleId === undefined ? null : excerpt(titleId);
  // Un titolo vuoto non descrive niente: S001 lo indica.
  if (title === null || title.text === "") {
    diagnostics.push(diagnostic("S001", title === null ? null : { bytes: title.bytes, utf16: title.utf16 }));
  }
  const descId = first("desc");
  const desc = descId === undefined ? null : excerpt(descId);
  const texts: Excerpt[] = [];
  const links: Reference[] = [];
  const embeds: Reference[] = [];
  // Il resto in ordine di documento, che è l'ordine dell'arena. Un `text`
  // dentro un altro non si disegna: `inside` è la fine dell'ultimo letto.
  let inside = 0;
  for (let id = 0; id < doc.nodes.length; id++) {
    const node = doc.nodes[id]!;
    if (node.kind !== "element") continue;
    for (const reason of activeContent(node)) diagnostics.push(diagnostic("S005", span(id), reason));
    if (node.ns !== NS_SVG) continue;
    if (node.local === "text" && node.start >= inside) {
      inside = node.end;
      const text = paragraph(doc, id);
      if (text !== "") texts.push({ text, ...span(id) });
    } else if (node.local === "a" || node.local === "image") {
      const attr = hrefAttr(node);
      if (attr === undefined) continue;
      const target = href(attr.value);
      const reference = (path: string): Reference => ({
        path,
        ...span(id),
        href: source.span(attr.raw[0], attr.raw[1]),
      });
      if (target.kind === "vault") {
        (node.local === "a" ? links : embeds).push(reference(target.url));
      } else if (node.local === "image" && target.kind === "data" && target.bytes > MAX_IMAGE_BYTES) {
        diagnostics.push(diagnostic("S006", span(id), String(target.bytes)));
      }
    }
  }
  return {
    title: title !== null && title.text !== "" ? title : null,
    desc: desc !== null && desc.text !== "" ? desc : null,
    texts,
    links,
    embeds,
  };
}
