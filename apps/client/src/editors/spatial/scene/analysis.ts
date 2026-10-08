// L'analisi della scena per l'indice (formato della scena, §9) e i controlli
// di §12 che non dipendono dalla classificazione.
//
// È `analysis.rs` di `fub-scene`. Due parti. [`index`] legge il documento
// intero, modificabile o estraneo: titolo, descrizione, testi, collegamenti e
// immagini del vault, con gli span; un disegno di Inkscape si cerca per i suoi
// testi anche se FubDraw non li modifica. Trova anche S001, S005 e S006.
// [`Tally`] invece segue la classificazione, che gli passa ogni elemento
// modificabile con il contesto ereditato dai contenitori: ne escono il
// riepilogo di `fub.scene.summary` e, con [`Legibility`], i controlli su come
// il disegno si legge (S009, S012, S013), che riguardano la scena come la
// modifica FubDraw.

import { Legibility, type Measures } from "./accessibility";
import { diagnostic, type Diagnostic } from "./diagnostics";
import { BoundsBuilder, fmax, fmin, parsePath, rectPath } from "./geometry";
import { apply, compose, IDENTITY, type Matrix, type Point } from "./matrix";
import type { Span } from "./text";
import {
  href,
  hrefId,
  isJavascript,
  keyword,
  length,
  nonNegativeLength,
  opacity,
  paint,
  paintReference,
  points,
  transform,
  trim,
  viewBox,
  wrapWidth,
  type Paint,
  type Rgb,
} from "./values";
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

/// Il contrasto minimo fra un tratto, o un testo grande, e ciò che ha sotto
/// (§12).
export const MIN_CONTRAST = 3;

/// Il contrasto minimo fra un testo e ciò che ha sotto (§12).
export const MIN_TEXT_CONTRAST = 4.5;

/// Da quanti pixel a grandezza naturale un testo è grande, e gli basta
/// [`MIN_CONTRAST`]: 18 punti, come in WCAG.
export const LARGE_TEXT = 24;

/// Da quanti pixel un testo in grassetto è grande: 14 punti.
export const LARGE_BOLD_TEXT = (14 * 96) / 72;

/// La grandezza minima di un testo a grandezza naturale, in pixel (§12).
export const MIN_TEXT_SIZE = 12;

/// La grandezza di un testo che non la dice, come nei browser.
export const DEFAULT_FONT_SIZE = 16;

/// Che cosa rappresenta un elemento modificabile (§4). `ngon` e `star` sono il
/// poligono regolare e la stella sintetici, un `path` con `fub:shape` (§6);
/// `polygon` è l'elemento `polygon`. `width` è il contorno a spessore
/// variabile, sintetico anche lui, e `connector` la linea che unisce due
/// oggetti (formato della scena, connettori).
export type Role =
  | "title"
  | "desc"
  | "paper"
  | "layer"
  | "group"
  | "link"
  | "stroke"
  | "arrow"
  | "connector"
  | "ngon"
  | "star"
  | "width"
  | "path"
  | "rect"
  | "ellipse"
  | "circle"
  | "line"
  | "polyline"
  | "polygon"
  | "text"
  | "image"
  /// La `defs` della radice, coi figli giudicati uno per uno (formato della
  /// scena, risorse).
  | "defs"
  /// Una risorsa modificabile di una `defs` della radice (formato della scena,
  /// risorse).
  | "resource"
  /// Una tavola: un `view` della radice (formato della scena, tavole).
  | "board";

/// Vero per i ruoli i cui figli si classificano uno per uno.
export function isContainer(role: Role): boolean {
  return role === "layer" || role === "group" || role === "link" || role === "defs";
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
  /// Le tavole modificabili, in ordine, ciascuna col suo nome sullo span del
  /// suo `view` (formato della scena, tavole).
  readonly boards: readonly Excerpt[];
}

/// Quanti oggetti modificabili ha la scena, per tipo.
export interface Counts {
  strokes: number;
  /// Frecce, connettori, poligoni regolari, stelle, tracciati, rettangoli,
  /// ellissi, cerchi, linee, polilinee e poligoni; la carta no.
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
  /// I nomi delle tavole, in ordine (formato della scena, tavole).
  readonly boards: readonly string[];
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

/// Gli attributi che cambiano ciò che si vede di un elemento oltre il suo
/// colore (formato della scena, risorse).
const EFFECTS = ["clip-path", "mask", "filter"] as const;

/// I campioni del documento, per id: il colore di ciascuno (formato della
/// scena, risorse).
export type Swatches = ReadonlyMap<string, Rgb>;

/// Quello che un contenitore modificabile trasmette ai figli.
export class Context {
  private constructor(
    /// Dalle coordinate locali a quelle della radice.
    readonly matrix: Matrix,
    /// Un antenato ha `display="none"`.
    readonly hidden: boolean,
    /// Il `fill` in vigore; `null` se la radice ne ha uno che §4 non legge.
    private readonly fillValue: Paint | null,
    /// Il `fill-opacity` in vigore, come `fill`.
    private readonly fillOpacity: number | null,
    /// Il prodotto delle `opacity` dei contenitori.
    private readonly opacity: number,
    /// Il `font-size` in vigore, in unità utente; `null` se la radice ne ha
    /// uno che §4 non legge.
    readonly fontSize: number | null,
    /// Il `font-weight` in vigore è da grassetto: `bold` o da 700 in su.
    readonly bold: boolean,
    /// Un antenato, o l'elemento, ha un ritaglio, una maschera o un filtro
    /// (formato della scena, risorse): i colori che si vedono non si sanno.
    private readonly effect: boolean,
    /// I campioni del documento, che danno il colore a chi li usa.
    private readonly swatches: Swatches,
  ) {}

  /// Il contesto dei figli della radice. Della radice contano solo `fill` e
  /// `fill-opacity`, che si ereditano.
  static root(root: ElementNode, swatches: Swatches): Context {
    return Context.rootOf((name) => valueOf(root, NS_NONE, name), swatches);
  }

  /// Come [`Context.root`], con gli attributi senza namespace della radice
  /// letti da `value`: per chi li ha già, come l'editor.
  static rootOf(value: (name: string) => string | undefined, swatches: Swatches): Context {
    const fill = value("fill");
    const alpha = value("fill-opacity");
    const size = value("font-size");
    const weight = value("font-weight");
    return new Context(
      IDENTITY,
      false,
      fill === undefined ? [0, 0, 0] : fillValue(fill, swatches),
      alpha === undefined ? 1 : opacity(alpha),
      1,
      size === undefined ? DEFAULT_FONT_SIZE : nonNegativeLength(size),
      weight !== undefined && bold(weight),
      false,
      swatches,
    );
  }

  /// Il contesto di `element`, un elemento modificabile: i suoi valori
  /// rispettano già §4.
  child(element: ElementNode): Context {
    return this.childOf((name) => valueOf(element, NS_NONE, name));
  }

  /// Come [`Context.child`], con gli attributi senza namespace
  /// dell'elemento letti da `value`.
  childOf(value: (name: string) => string | undefined): Context {
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
    const size = value("font-size");
    const weight = value("font-weight");
    const effect = EFFECTS.some((name) => {
      const used = value(name);
      return used !== undefined && trim(used) !== "none";
    });
    return new Context(
      matrix,
      hidden,
      fill === undefined ? this.fillValue : fillValue(fill, this.swatches),
      alpha === undefined ? this.fillOpacity : opacity(alpha),
      group === null ? this.opacity : this.opacity * group,
      size === undefined ? this.fontSize : nonNegativeLength(size),
      weight === undefined ? this.bold : bold(weight),
      this.effect || effect,
      this.swatches,
    );
  }

  /// Il contesto di una riga di `text`, un `tspan`: come [`Context.child`], ma
  /// senza `transform`, che SVG non applica a un `tspan`.
  line(tspan: ElementNode): Context {
    const line = this.child(tspan);
    return new Context(
      this.matrix,
      line.hidden,
      line.fillValue,
      line.fillOpacity,
      line.opacity,
      line.fontSize,
      line.bold,
      line.effect,
      this.swatches,
    );
  }

  /// Il colore del riempimento con la sua opacità totale; `null` se non si
  /// sa o se è `none`.
  fill(): [Rgb, number] | null {
    const fill = this.fillPaint();
    return fill === "none" ? null : fill;
  }

  /// Il riempimento in vigore, distinguendo ciò che non si sa: `null` se non
  /// si sa, `"none"` se è `none`.
  fillPaint(): [Rgb, number] | "none" | null {
    if (this.effect || this.fillValue === null || this.fillOpacity === null) return null;
    if (this.fillValue === "none") return "none";
    return [this.fillValue, this.fillOpacity * this.opacity];
  }

  /// Il colore della carta sul bianco della superficie; `null` se non si sa.
  paperColor(): Rgb | null {
    if (this.hidden) return WHITE;
    if (this.effect || this.fillValue === null || this.fillOpacity === null) return null;
    if (this.fillValue === "none") return WHITE;
    return over(this.fillValue, this.fillOpacity * this.opacity, WHITE);
  }
}

export const WHITE: Rgb = [255, 255, 255];

/// Un `fill` come lo legge §4. Un campione del documento vale il suo colore,
/// quale che sia il ripiego scritto accanto: è il colore che si vede
/// (formato della scena, risorse). Le altre risorse non si sanno.
function fillValue(value: string, swatches: Swatches): Paint | null {
  const used = paintReference(value);
  if (used === null) return paint(value);
  return swatches.get(used.id) ?? null;
}

/// Vero per un `font-weight` da grassetto: `bold` o da 700 in su.
function bold(weight: string): boolean {
  return keyword("font-weight", weight) && ["bold", "700", "800", "900"].includes(trim(weight));
}

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

/// Una tavola com'è scritta (formato della scena, tavole).
interface Board {
  readonly id: string;
  readonly name: string;
  readonly box: readonly [number, number, number, number];
  readonly span: Span;
}

/// Una carta: `board` è la sua tavola, `fub:board`, e `box` la sua geometria.
interface Paper {
  readonly id: string | null;
  readonly board: string | null;
  readonly box: readonly [number, number, number, number];
  readonly span: Span;
}

/// Il nome di una tavola: il testo del suo primo `title`, con gli spazi
/// ridotti come li disegna SVG; senza, o vuoto, il suo id (formato della
/// scena, tavole).
export function boardName(doc: XmlDocument, element: ElementNode): string {
  for (const child of element.children) {
    const node = doc.element(child);
    if (node === null || !isSvg(node, "title")) continue;
    const text: string[] = [];
    textContent(doc, child, text);
    const name = collapse(text.join(""));
    if (name !== "") return name;
    break;
  }
  return valueOf(element, NS_NONE, "id") ?? "";
}

/// Il riepilogo che si accumula durante la classificazione.
export class Tally {
  private readonly layers: string[] = [];
  /// Le tavole e le carte, in ordine di documento.
  private readonly sheets: Board[] = [];
  private readonly papers: Paper[] = [];
  private readonly counts: Counts = { strokes: 0, shapes: 0, texts: 0, images: 0, links: 0, foreign: 0 };
  private readonly ink: InkTotals = { samples: 0, duration: 0 };
  private readonly bounds = new BoundsBuilder();
  /// Il colore della prima carta: `undefined` senza carta, `null` se non si
  /// sa.
  private paper: Rgb | null | undefined = undefined;
  /// I controlli su come il disegno si legge, da chiudere alla fine: la
  /// carta può venire dopo.
  private readonly legibility: Legibility;
  /// Il `d` dei tracciati delle risorse, per id: il riquadro di un testo su
  /// tracciato è quello del tracciato (formato della scena, testo).
  private readonly paths: ReadonlyMap<string, string>;

  constructor(paths: ReadonlyMap<string, string> = new Map()) {
    this.paths = paths;
    this.legibility = new Legibility(paths);
  }

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
      // Le risorse non si disegnano da sole: contano gli oggetti che le
      // usano (formato della scena, risorse).
      case "defs":
      case "resource":
        return;
      case "layer":
        this.layers.push(valueOf(element, NS_FUB, "layer") ?? "");
        break;
      case "board":
        this.sheets.push({
          id: valueOf(element, NS_NONE, "id")!,
          name: boardName(doc, element),
          box: viewBox(valueOf(element, NS_NONE, "viewBox")!)!,
          span,
        });
        return;
      case "paper":
        if (this.paper === undefined) this.paper = context.paperColor();
        this.papers.push({
          id: valueOf(element, NS_NONE, "id") ?? null,
          board: valueOf(element, NS_FUB, "board") ?? null,
          box: [len(element, "x") ?? 0, len(element, "y") ?? 0, len(element, "width") ?? 0, len(element, "height") ?? 0],
          span,
        });
        return;
      case "stroke":
        this.counts.strokes++;
        if (stroke !== null) {
          this.ink.samples += stroke.samples ?? 0;
          const duration = Math.max(stroke.duration ?? 0, 0);
          // `saturating_add` su `i64`.
          this.ink.duration = Math.min(this.ink.duration + duration, I64_MAX);
        }
        break;
      case "arrow":
      case "connector":
      case "ngon":
      case "star":
      case "width":
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
    if (!context.hidden) {
      bounds(doc, element, role, context.matrix, this.bounds, this.paths);
      this.legibility.element(doc, element, role, context, span, stroke);
    }
  }

  /// Ciò che i controlli su come il disegno si legge hanno misurato, dopo
  /// [`Tally.finish`].
  get measures(): Measures {
    return this.legibility.measures;
  }

  /// Le tavole, in ordine, col loro nome sullo span del `view`: le sezioni
  /// del disegno (formato della scena, tavole).
  get boards(): Excerpt[] {
    return this.sheets.map((board) => ({ text: board.name, ...board.span }));
  }

  /// S015: le carte che non vanno con la loro tavola (formato della scena,
  /// tavole).
  private checkPapers(diagnostics: Diagnostic[]): void {
    const boards = new Map<string, Board>();
    for (const board of this.sheets) if (!boards.has(board.id)) boards.set(board.id, board);
    const owned = new Set<string>();
    for (const paper of this.papers) {
      let reason: string | null = null;
      if (paper.board === null) {
        if (this.sheets.length > 0) reason = "free";
      } else {
        const board = boards.get(paper.board);
        if (board === undefined) {
          reason = "board";
        } else if (owned.has(paper.board)) {
          reason = "second";
        } else {
          owned.add(paper.board);
          if (paper.box.some((v, i) => v !== board.box[i])) reason = "geometry";
        }
      }
      if (reason !== null) diagnostics.push(diagnostic("S015", paper.span, paper.id === null ? reason : `${paper.id} ${reason}`));
    }
  }

  /// Chiude il conteggio: il riepilogo, più i controlli su come il disegno si
  /// legge.
  finish(foreign: boolean, version: number | null, diagnostics: Diagnostic[]): Summary {
    // Senza carta il disegno sta sul bianco della superficie (§12).
    this.legibility.finish(this.paper === undefined ? WHITE : this.paper, diagnostics);
    this.checkPapers(diagnostics);
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
      boards: this.sheets.map((board) => board.name),
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
    boards: [],
    counts: { strokes: 0, shapes: 0, texts: 0, images: 0, links: 0, foreign: 0 },
    ink: { samples: 0, duration: 0 },
    bbox: null,
  };
}

/// Una lunghezza di `element`, già validata da §4.
export function len(element: ElementNode, name: string): number | null {
  const value = valueOf(element, NS_NONE, name);
  return value === undefined ? null : length(value);
}

/// I raggi di un'ellisse o degli angoli di un rettangolo: in SVG 2 un raggio
/// assente vale l'altro.
export function radii(element: ElementNode): Point {
  const rx = len(element, "rx");
  const ry = len(element, "ry");
  if (rx !== null && ry !== null) return [rx, ry];
  if (rx !== null) return [rx, rx];
  if (ry !== null) return [ry, ry];
  return [0, 0];
}

/// Il `d` del tracciato che un testo segue, fra quelli di `paths`; `null` per
/// un testo con le righe.
export function followed(doc: XmlDocument, element: ElementNode, paths: ReadonlyMap<string, string>): string | null {
  for (const child of element.children) {
    const node = doc.element(child);
    if (node === null || !isSvg(node, "textPath")) continue;
    const attr = hrefAttr(node);
    const id = attr === undefined ? null : hrefId(attr.value);
    return id === null ? null : paths.get(id) ?? null;
  }
  return null;
}

/// Aggiunge a `out` la geometria di `element` trasformata da `m`: quella che
/// `getBBox` misura, senza lo spessore del contorno. `paths` sono i
/// tracciati delle risorse.
function bounds(
  doc: XmlDocument,
  element: ElementNode,
  role: Role,
  m: Matrix,
  out: BoundsBuilder,
  paths: ReadonlyMap<string, string>,
): void {
  const at = (name: string): number => len(element, name) ?? 0;
  switch (role) {
    case "stroke":
    case "arrow":
    case "connector":
    case "ngon":
    case "star":
    case "width":
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
      // contano i punti d'inizio delle righe, un `tspan` per riga, o i punti
      // estremi del tracciato che il testo segue.
      const d = followed(doc, element, paths);
      if (d !== null) {
        const segments = parsePath(d);
        if (segments !== null) out.path(segments, m);
        break;
      }
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
export function textContent(doc: XmlDocument, id: NodeId, out: string[]): void {
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
/// spazio, tranne in un testo in area quelle che continuano una parola dopo
/// la prima, con `fub:join="word"`, che si uniscono senza (formato della
/// scena, testo).
export function paragraph(doc: XmlDocument, id: NodeId): string {
  const wrap = valueOf(doc.element(id)!, NS_FUB, "wrap");
  const area = wrap !== undefined && wrapWidth(wrap) !== null;
  // Le righe, e se ognuna continua una parola.
  const lines: Array<[string, boolean]> = [];
  let run: string[] = [];
  let first = true;
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
          lines.push([collapse(run.join("")), false]);
          run = [];
          const line: string[] = [];
          textContent(doc, child, line);
          const word = area && !first && isSvg(node, "tspan") && valueOf(node, NS_FUB, "join") === "word";
          lines.push([collapse(line.join("")), word]);
          first = false;
        }
        break;
      default:
        break;
    }
  }
  lines.push([collapse(run.join("")), false]);
  let out = "";
  for (const [line, word] of lines) {
    if (line !== "") out += out === "" || word ? line : ` ${line}`;
  }
  return out;
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

/// Legge l'indice del documento, con S001, S005, S006 e S016. `boards` sono
/// le tavole che la classificazione ha trovato (formato della scena,
/// tavole).
export function index(doc: XmlDocument, diagnostics: Diagnostic[], boards: readonly Excerpt[] = []): Index {
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
  // Un nome già del disegno o di una tavola prima: `#nome` mostra quella
  // (S016).
  const names = new Set<string>(title === null || title.text === "" ? [] : [title.text]);
  for (const board of boards) {
    if (names.has(board.text)) diagnostics.push(diagnostic("S016", { bytes: board.bytes, utf16: board.utf16 }, board.text));
    else names.add(board.text);
  }
  return {
    title: title !== null && title.text !== "" ? title : null,
    desc: desc !== null && desc.text !== "" ? desc : null,
    texts,
    links,
    embeds,
    boards,
  };
}
