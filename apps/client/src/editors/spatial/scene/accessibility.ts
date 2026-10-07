// I controlli di §12 su come il disegno si legge: S009, il contrasto fra un
// tratto a penna o un testo e ciò che ha sotto; S012, un'immagine senza
// descrizione; S013, un testo troppo piccolo a grandezza naturale.
//
// È `accessibility.rs` di `fub-scene`, con le stesse operazioni nello stesso
// ordine: i due lati devono trovare le stesse diagnostiche con gli stessi
// dettagli. [`Legibility`] segue la classificazione insieme al riepilogo, in
// ordine di documento, che in SVG è l'ordine in cui si dipinge: ciò che sta
// sotto un oggetto è dipinto prima di lui. Il fondo di un punto è la carta con
// sopra, composte una dopo l'altra, le forme piene modificabili che lo
// coprono, con le loro opacità. Un'immagine rende il fondo ignoto finché una
// forma opaca non la copre, perché dei suoi pixel non si sa niente; così una
// forma il cui colore non si sa. Come per la carta, il CSS e i blocchi
// estranei non contano, e nemmeno i tratti a mano libera, che sono sottili.
//
// Dove si guarda:
//
// - **un testo**, una volta per riga: nel punto d'inizio del `tspan`, alzato
//   di 0,35 volte la grandezza dei caratteri, a metà dell'occhio delle
//   minuscole. Senza i caratteri la larghezza della riga non si sa, e
//   l'inizio sta sempre sul testo, qualunque sia `text-anchor`;
// - **un tratto a penna**, in sedici punti del contorno presi a distanze
//   uguali fra i suoi vertici. Conta il contrasto mediano, quello che il
//   tratto ha per gran parte della sua lunghezza: un tratto che attraversa
//   un riquadro scuro non si legge male per questo.
//
// In più di Rust, [`Legibility.measures`] dice che cosa S009 e S013 hanno
// misurato: il colore, il fondo e la soglia del punto peggiore, e quanto la
// matrice ingrandisce un testo. Servono all'editor per proporre un colore
// che si legga o un corpo abbastanza grande; la diagnostica resta quella dei
// due lati.

import {
  collapse,
  contrast,
  DEFAULT_FONT_SIZE,
  LARGE_BOLD_TEXT,
  LARGE_TEXT,
  len,
  MIN_CONTRAST,
  MIN_TEXT_CONTRAST,
  MIN_TEXT_SIZE,
  over,
  radii,
  textContent,
  type Context,
  type Role,
  type Stroke,
} from "./analysis";
import { diagnostic, type Diagnostic } from "./diagnostics";
import {
  BoundsBuilder,
  ellipsePath,
  flatten,
  parsePath,
  pointsPath,
  rectPath,
  winding,
  type Bounds,
  type Segment,
} from "./geometry";
import { apply, type Matrix, type Point } from "./matrix";
import type { Span } from "./text";
import { points, trim, type Rgb } from "./values";
import { isSvg, NS_NONE, valueOf, type ElementNode, type XmlDocument } from "./xml";

/// In quanti punti del contorno si misura un tratto a penna.
const STROKE_PROBES = 16;

/// Quanto sopra la linea di base si guarda una riga, in grandezze dei
/// caratteri.
const LINE_PROBE = 0.35;

/// Un colore con la sua opacità totale.
export type Color = readonly [Rgb, number];

/// Ciò che S009 ha misurato in un oggetto, nel punto dove si legge peggio.
export interface Contrast {
  readonly span: Span;
  /// Il colore dell'oggetto con la sua opacità totale, il fondo sotto di lui
  /// e il contrasto che gli basta.
  readonly color: Color;
  readonly under: Rgb;
  readonly threshold: number;
  /// Vero se il colore è quello di una riga, scritto sul suo `tspan`: il
  /// colore del testo non lo cambia.
  readonly line: boolean;
}

/// Ciò che S013 ha misurato in un testo.
export interface Smallness {
  readonly span: Span;
  /// Quanto la matrice allunga il verticale: il corpo a grandezza naturale
  /// è il corpo scritto per questo.
  readonly scale: number;
  /// Vero se la riga più piccola ha un corpo suo, scritto sul suo `tspan`:
  /// il corpo del testo non lo cambia.
  readonly line: boolean;
}

/// Ciò che i controlli hanno misurato, per le correzioni dell'editor.
export interface Measures {
  readonly contrasts: readonly Contrast[];
  readonly sizes: readonly Smallness[];
}

/// Una figura dipinta: dove sta e di che colore.
class Painted {
  /// I poligoni nella radice, calcolati alla prima domanda.
  private polygons: Point[][] | null = null;

  constructor(
    /// I segmenti nelle coordinate della figura, e la matrice verso la radice.
    private readonly segments: readonly Segment[],
    private readonly matrix: Matrix,
    /// Il rettangolo che la contiene nella radice: un punto fuori non la
    /// tocca, e i poligoni non servono.
    private readonly bounds: Bounds,
    /// Il colore con la sua opacità totale; `null` se non si sa, come per
    /// un'immagine.
    readonly paint: Color | null,
  ) {}

  /// Vero se la figura copre il punto `p` della radice.
  covers(p: Point): boolean {
    const { min, max } = this.bounds;
    if (!(p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1])) return false;
    this.polygons ??= flatten(this.segments, this.matrix);
    return winding(this.polygons, p) !== 0;
  }
}

/// Una riga di testo da misurare.
interface Line {
  /// Il punto in cui si guarda, nella radice.
  readonly at: Point;
  /// Il colore dei caratteri con la sua opacità; `null` se è `none` o non si
  /// sa, e allora la riga non si misura.
  readonly color: Color | null;
  /// Il contrasto che le basta: [`MIN_CONTRAST`] per un testo grande,
  /// [`MIN_TEXT_CONTRAST`] per gli altri.
  readonly threshold: number;
  /// Il `tspan` scrive il suo colore.
  readonly own: boolean;
}

/// Ciò che si confronta col fondo: un tratto a penna, col colore e i punti del
/// contorno nella radice, o un testo, riga per riga.
type Subject =
  | { readonly kind: "pen"; readonly color: Color; readonly probes: readonly Point[] }
  | { readonly kind: "text"; readonly lines: readonly Line[] };

/// Un oggetto da confrontare col suo fondo alla fine, quando la carta si sa.
interface Check {
  readonly span: Span;
  readonly subject: Subject;
  /// Quante figure erano dipinte prima dell'oggetto: quelle che possono
  /// stargli sotto.
  readonly under: number;
}

/// I controlli su come il disegno si legge, durante la classificazione.
export class Legibility {
  private readonly painted: Painted[] = [];
  private readonly checks: Check[] = [];
  /// S012 e S013, che non dipendono dal fondo.
  private readonly found: Diagnostic[] = [];
  private readonly contrasts: Contrast[] = [];
  private readonly sizes: Smallness[] = [];

  /// Ciò che S009 e S013 hanno misurato; S009 dopo [`Legibility.finish`].
  get measures(): Measures {
    return { contrasts: this.contrasts, sizes: this.sizes };
  }

  /// Guarda un elemento modificabile visibile. `context` è quello
  /// dell'elemento, con i suoi attributi già applicati.
  element(
    doc: XmlDocument,
    element: ElementNode,
    role: Role,
    context: Context,
    span: Span,
    stroke: Stroke | null,
  ): void {
    const m = context.matrix;
    const at = (name: string): number => len(element, name) ?? 0;
    let shape: Segment[];
    switch (role) {
      case "stroke": {
        if (stroke !== null && stroke.tool === "pen") {
          const color = context.fill();
          if (color !== null) this.check(span, { kind: "pen", color, probes: outlineProbes(element, m) });
        }
        return;
      }
      case "text":
        this.text(doc, element, context, span);
        return;
      case "image":
        if (!decorative(element) && !described(doc, element)) this.found.push(diagnostic("S012", span));
        this.paint(rectPath(at("x"), at("y"), at("width"), at("height"), 0, 0), m, null);
        return;
      case "rect": {
        const [rx, ry] = radii(element);
        shape = rectPath(at("x"), at("y"), at("width"), at("height"), rx, ry);
        break;
      }
      case "ellipse":
        shape = ellipsePath([at("cx"), at("cy")], radii(element));
        break;
      case "circle":
        shape = ellipsePath([at("cx"), at("cy")], [at("r"), at("r")]);
        break;
      case "polygon":
      case "polyline": {
        const value = valueOf(element, NS_NONE, "points");
        shape = pointsPath((value === undefined ? null : points(value)) ?? []);
        break;
      }
      case "path":
      case "arrow":
      case "ngon":
      case "star":
      case "width": {
        const d = valueOf(element, NS_NONE, "d");
        shape = (d === undefined ? null : parsePath(d)) ?? [];
        break;
      }
      default:
        return;
    }
    const fill = context.fillPaint();
    // Un riempimento ignoto copre come un'immagine.
    if (fill === null) this.paint(shape, m, null);
    else if (fill !== "none" && fill[1] > 0) this.paint(shape, m, fill);
  }

  private check(span: Span, subject: Subject): void {
    this.checks.push({ span, subject, under: this.painted.length });
  }

  private paint(segments: Segment[], matrix: Matrix, paint: Color | null): void {
    const bounds = new BoundsBuilder();
    bounds.path(segments, matrix);
    const box = bounds.finish();
    if (box !== null) this.painted.push(new Painted(segments, matrix, box, paint));
  }

  /// Le righe di un testo, con S013 se la più piccola sta sotto
  /// [`MIN_TEXT_SIZE`] a grandezza naturale. Le righe vuote o nascoste non si
  /// guardano.
  private text(doc: XmlDocument, element: ElementNode, context: Context, span: Span): void {
    const m = context.matrix;
    // Quanto la matrice allunga il verticale: l'altezza dei caratteri. Una
    // radice quadrata e non `Math.hypot`, che può differire da Rust
    // nell'ultima cifra binaria.
    const [, , c, d] = m;
    const scale = Math.sqrt(c * c + d * d);
    const x = len(element, "x") ?? 0;
    let y = len(element, "y") ?? 0;
    const lines: Line[] = [];
    let smallest: number | null = null;
    let ownSize = false;
    for (const child of element.children) {
      const tspan = doc.element(child);
      if (tspan === null || !isSvg(tspan, "tspan")) continue;
      y += len(tspan, "dy") ?? 0;
      const line = context.line(tspan);
      const words: string[] = [];
      textContent(doc, child, words);
      if (line.hidden || collapse(words.join("")) === "") continue;
      const size = line.fontSize === null ? null : line.fontSize * scale;
      if (size !== null && (smallest === null || size < smallest)) {
        smallest = size;
        ownSize = valueOf(tspan, NS_NONE, "font-size") !== undefined;
      }
      // Un testo di grandezza ignota conta come un testo normale.
      const large = size !== null && (size >= LARGE_TEXT || (line.bold && size >= LARGE_BOLD_TEXT));
      const lift = LINE_PROBE * (line.fontSize ?? DEFAULT_FONT_SIZE);
      const fill = line.fillPaint();
      lines.push({
        at: apply(m, [len(tspan, "x") ?? x, y - lift]),
        color: fill === "none" ? null : fill,
        threshold: large ? MIN_CONTRAST : MIN_TEXT_CONTRAST,
        own: valueOf(tspan, NS_NONE, "fill") !== undefined,
      });
    }
    if (smallest !== null && smallest < MIN_TEXT_SIZE) {
      this.found.push(diagnostic("S013", span, shown(smallest)));
      this.sizes.push({ span, scale, line: ownSize });
    }
    if (lines.length > 0) this.check(span, { kind: "text", lines });
  }

  /// Chiude i controlli: S009 per ogni oggetto che contrasta poco col suo
  /// fondo, poi S012 e S013. `paper` è il colore della carta, `null` se non si
  /// sa.
  finish(paper: Rgb | null, diagnostics: Diagnostic[]): void {
    for (const check of this.checks) {
      const backdrop = (p: Point): Rgb | null => this.backdrop(paper, check.under, p);
      let worst: { readonly ratio: number; readonly measured: Contrast } | null = null;
      if (check.subject.kind === "pen") {
        const color = check.subject.color;
        const [rgb, alpha] = color;
        const ratios: Array<readonly [number, Rgb]> = [];
        for (const p of check.subject.probes) {
          const under = backdrop(p);
          if (under !== null) ratios.push([contrast(over(rgb, alpha, under), under), under]);
        }
        ratios.sort((a, b) => a[0] - b[0]);
        // La mediana bassa, quando i punti sono pari.
        const median = ratios[Math.floor(Math.max(ratios.length - 1, 0) / 2)];
        if (median !== undefined && median[0] < MIN_CONTRAST) {
          worst = { ratio: median[0], measured: { span: check.span, color, under: median[1], threshold: MIN_CONTRAST, line: false } };
        }
      } else {
        for (const line of check.subject.lines) {
          if (line.color === null) continue;
          const under = backdrop(line.at);
          if (under === null) continue;
          const [rgb, alpha] = line.color;
          const ratio = contrast(over(rgb, alpha, under), under);
          if (ratio < line.threshold && (worst === null || ratio < worst.ratio)) {
            worst = { ratio, measured: { span: check.span, color: line.color, under, threshold: line.threshold, line: line.own } };
          }
        }
      }
      if (worst !== null) {
        diagnostics.push(diagnostic("S009", check.span, shown(worst.ratio)));
        this.contrasts.push(worst.measured);
      }
    }
    diagnostics.push(...this.found);
  }

  /// Il colore sotto il punto `p` della radice, con le prime `under` figure
  /// dipinte sopra la carta; `null` se non si sa.
  private backdrop(paper: Rgb | null, under: number, p: Point): Rgb | null {
    let color = paper;
    for (let i = 0; i < under; i++) {
      const painted = this.painted[i]!;
      if (!painted.covers(p)) continue;
      const paint = painted.paint;
      if (paint === null) color = null;
      // Una figura opaca copre anche un fondo ignoto.
      else if (paint[1] >= 1) color = paint[0];
      else color = color === null ? null : over(paint[0], paint[1], color);
    }
    return color;
  }
}

/// Un numero del dettaglio, troncato ai centesimi e non arrotondato: un
/// contrasto di 2,996 non deve leggersi «3.00».
function shown(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}

/// I punti in cui si misura un tratto, nella radice: gli estremi dei segmenti
/// del contorno, o [`STROKE_PROBES`] di loro a distanze uguali nell'elenco
/// quando sono di più.
function outlineProbes(element: ElementNode, m: Matrix): Point[] {
  const d = valueOf(element, NS_NONE, "d");
  const ends: Point[] = [];
  for (const segment of (d === undefined ? null : parsePath(d)) ?? []) {
    if (segment.kind !== "close") ends.push(segment.to);
  }
  if (ends.length <= STROKE_PROBES) return ends.map((p) => apply(m, p));
  const probes: Point[] = [];
  for (let k = 0; k < STROKE_PROBES; k++) {
    probes.push(apply(m, ends[Math.floor((k * (ends.length - 1)) / (STROKE_PROBES - 1))]!));
  }
  return probes;
}

/// Vero se l'immagine dice di essere decorativa, con `aria-hidden="true"`:
/// chi legge con lo screen reader non la incontra, e non serve descriverla.
function decorative(element: ElementNode): boolean {
  const value = valueOf(element, NS_NONE, "aria-hidden");
  return value !== undefined && trim(value) === "true";
}

/// Vero se l'elemento ha un `title` o un `desc` con del testo.
function described(doc: XmlDocument, element: ElementNode): boolean {
  return element.children.some((child) => {
    const node = doc.element(child);
    if (node === null || !(isSvg(node, "title") || isSvg(node, "desc"))) return false;
    const text: string[] = [];
    textContent(doc, child, text);
    return collapse(text.join("")) !== "";
  });
}
