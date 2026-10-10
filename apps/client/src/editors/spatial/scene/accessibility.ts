// I controlli di §12 su come il disegno si legge: S009, il contrasto fra un
// tratto a penna o un testo e ciò che ha sotto; S012, un'immagine senza
// descrizione; S013, un testo troppo piccolo a grandezza naturale; S017, due
// colori usati come codice che si distinguono soltanto per la tinta.
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
// Un simbolo (formato della scena, simboli) si guarda una volta, nelle sue
// coordinate: il suo contenuto non sta dove si vede, quindi non dipinge e non
// si confronta col fondo, ma un'immagine senza descrizione (S012) e un testo
// troppo piccolo nelle coordinate del simbolo (S013) restano. Un'istanza
// copre ciò che ha sotto col riquadro del suo simbolo, come un'immagine: il
// fondo che dà non si sa.
//
// Dove si guarda:
//
// - **un testo**, una volta per riga: nel punto d'inizio del `tspan`, alzato
//   di 0,35 volte la grandezza dei caratteri, a metà dell'occhio delle
//   minuscole. Senza i caratteri la larghezza della riga non si sa, e
//   l'inizio sta sempre sul testo, qualunque sia `text-anchor`. Un pezzo
//   della riga con un colore, un corpo o un peso suoi si guarda nello stesso
//   punto, col suo aspetto. Un testo su tracciato è una riga sola, e si
//   guarda nel punto di `startOffset` sul tracciato, alzato allo stesso modo
//   dalla parte dove stanno i caratteri;
// - **un tratto a penna**, in sedici punti del contorno presi a distanze
//   uguali fra i suoi vertici. Conta il contrasto mediano, quello che il
//   tratto ha per gran parte della sua lunghezza: un tratto che attraversa
//   un riquadro scuro non si legge male per questo.
//
// S017 guarda le stesse figure dipinte, quelle che coprono la carta, e dice
// dove un disegno affida un significato al colore soltanto (WCAG 1.4.1, uso
// del colore): due colori con meno di 3:1 fra loro (WCAG 1.4.11) non si
// distinguono più per chi non vede la tinta, e non si capisce quale area va
// con quale voce della legenda.
//
// - **le aree** sono le forme piene modificabili di cui il colore si sa, un
//   colore semplice o un campione del documento, con un'opacità totale sopra
//   0. Non contano i tratti a penna e l'evidenziatore, che sono sottili, né i
//   testi, le immagini, la carta, le tavole, i livelli e i gruppi in sé. Una
//   sfumatura, un motivo (e quindi una campitura), un colore che decide una
//   risorsa e ogni colore sotto `clip-path`, `mask` o `filter`, dell'elemento
//   o di un contenitore, non si sanno, come per S009. Una figura il cui
//   riquadro nella radice non ha larghezza o non ha altezza non è un'area, e
//   una nascosta (`display="none"`, anche di un contenitore) non si guarda
//   affatto;
// - **il colore di un'area** è il suo colore con la sua opacità totale (il
//   `fill-opacity` e le `opacity` dei gruppi, composte come per S009)
//   composto sulla carta, o sul bianco senza carta, in sRGB e coi canali
//   arrotondati a interi. Sulla carta soltanto, e non sulle figure sotto: il
//   codice è il colore che l'autore ha scelto, non quello di ciò che per
//   caso copre. Se la carta non si sa, un'area non opaca non ha colore che si
//   sappia, come un fondo ignoto per S009;
// - **i colori di codice** sono i colori composti che hanno almeno due aree:
//   una fetta e la sua voce di legenda, due riquadri della stessa categoria.
//   Un colore usato una volta è un ornamento, non un codice. Con più di 12
//   colori di codice S017 tace: è un'illustrazione o un'immagine ricalcata,
//   non un codice;
// - **una coppia confusa** è fatta di due colori di codice con un contrasto
//   di WCAG sotto [`MIN_CONTRAST`] (3:1, la stessa soglia di S009 per un
//   tratto);
// - **una S017 per ogni colore di codice** che ha almeno un compagno confuso,
//   sulla prima area del documento con quel colore. Il dettaglio è
//   `#rrggbb #rrggbb r.rr`: il colore, il compagno col contrasto più basso (a
//   parità, quello la cui prima area viene prima nel documento) e quel
//   contrasto, troncato ai centesimi come per S009.
//
// In più di Rust, [`Legibility.measures`] dice che cosa S009, S013 e S017
// hanno misurato: il colore, il fondo e la soglia del punto peggiore, quanto
// la matrice ingrandisce un testo, e di un colore confuso tutte le aree che
// lo portano. Servono all'editor per proporre un colore che si legga, un
// corpo abbastanza grande o una campitura che distingua le aree; la
// diagnostica resta quella dei due lati.

import {
  collapse,
  contrast,
  DEFAULT_FONT_SIZE,
  followed,
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
  along,
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
import { points, startOffset, trim, type Rgb } from "./values";
import { isSvg, NS_NONE, valueOf, type ElementNode, type NodeId, type XmlDocument } from "./xml";

/// In quanti punti del contorno si misura un tratto a penna.
const STROKE_PROBES = 16;

/// Con più colori di codice di così S017 tace: è un'illustrazione, non un
/// codice.
const MAX_CODES = 12;

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
  /// Vero se il colore è quello di una riga o di un pezzo, scritto sul suo
  /// `tspan`: il colore del testo non lo cambia.
  readonly line: boolean;
}

/// Ciò che S013 ha misurato in un testo.
export interface Smallness {
  readonly span: Span;
  /// Quanto la matrice allunga il verticale: il corpo a grandezza naturale
  /// è il corpo scritto per questo.
  readonly scale: number;
  /// Vero se la riga o il pezzo più piccolo ha un corpo suo, scritto sul
  /// suo `tspan`: il corpo del testo non lo cambia.
  readonly line: boolean;
}

/// Ciò che S017 ha misurato per un colore di codice confuso con un altro.
export interface Confusion {
  /// La prima area col colore, dove sta la diagnostica.
  readonly span: Span;
  /// Il colore delle aree, composto sulla carta.
  readonly color: Rgb;
  /// Il compagno con cui contrasta di meno, e quanto.
  readonly partner: Rgb;
  readonly ratio: number;
  /// Tutte le aree col colore, in ordine di documento: la prima è `span`.
  readonly areas: readonly Span[];
}

/// Ciò che i controlli hanno misurato, per le correzioni dell'editor.
export interface Measures {
  readonly contrasts: readonly Contrast[];
  readonly sizes: readonly Smallness[];
  readonly confusions: readonly Confusion[];
}

/// Il rettangolo che non contiene niente: il posto di un'istanza finché il
/// riquadro del suo simbolo non si sa.
const NOWHERE: Bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };

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
    /// L'elemento che ha dipinto la figura.
    readonly span: Span,
  ) {}

  /// Vero se il riquadro nella radice ha larghezza e altezza.
  get hasArea(): boolean {
    const { min, max } = this.bounds;
    return max[0] > min[0] && max[1] > min[1];
  }

  /// Vero se la figura copre il punto `p` della radice.
  covers(p: Point): boolean {
    const { min, max } = this.bounds;
    if (!(p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1])) return false;
    this.polygons ??= flatten(this.segments, this.matrix);
    return winding(this.polygons, p) !== 0;
  }
}

/// Un colore composto sulla carta che hanno delle aree (S017).
interface Tint {
  readonly color: Rgb;
  /// Le aree col colore, in ordine di documento.
  readonly areas: Span[];
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
  /// La riga o il pezzo scrive il suo colore.
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
  /// Le istanze dipinte: il loro posto fra le figure, il simbolo e la
  /// matrice. Il riquadro del simbolo si sa alla fine.
  private readonly instances: Array<readonly [number, string, Matrix]> = [];
  private readonly checks: Check[] = [];
  /// S012 e S013, che non dipendono dal fondo.
  private readonly found: Diagnostic[] = [];
  private readonly contrasts: Contrast[] = [];
  private readonly sizes: Smallness[] = [];
  private readonly confusions: Confusion[] = [];

  constructor(
    /// Il `d` dei tracciati delle risorse, per id (formato della scena,
    /// testo).
    private readonly paths: ReadonlyMap<string, string> = new Map(),
  ) {}

  /// Ciò che S009, S013 e S017 hanno misurato; S009 e S017 dopo
  /// [`Legibility.finish`].
  get measures(): Measures {
    return { contrasts: this.contrasts, sizes: this.sizes, confusions: this.confusions };
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
    // Il contenuto di un simbolo non sta dove si vede: non dipinge e non si
    // confronta col fondo.
    const inSymbol = context.symbol !== null;
    let shape: Segment[];
    switch (role) {
      case "stroke": {
        if (stroke !== null && stroke.tool === "pen" && !inSymbol) {
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
        if (!inSymbol) this.paint(rectPath(at("x"), at("y"), at("width"), at("height"), 0, 0), m, null, span);
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
      case "connector":
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
    if (inSymbol) return;
    const fill = context.fillPaint();
    // Un riempimento ignoto copre come un'immagine.
    if (fill === null) this.paint(shape, m, null, span);
    else if (fill !== "none" && fill[1] > 0) this.paint(shape, m, fill, span);
  }

  /// Guarda un'istanza visibile fuori dai simboli, del simbolo `symbol` con
  /// la matrice `matrix`: copre ciò che ha sotto col riquadro del simbolo,
  /// come un'immagine, perché il contenuto del simbolo non si guarda in ogni
  /// istanza.
  instance(symbol: string, matrix: Matrix, span: Span): void {
    this.instances.push([this.painted.length, symbol, matrix]);
    this.painted.push(new Painted([], matrix, NOWHERE, null, span));
  }

  private check(span: Span, subject: Subject): void {
    this.checks.push({ span, subject, under: this.painted.length });
  }

  private paint(segments: Segment[], matrix: Matrix, paint: Color | null, span: Span): void {
    const bounds = new BoundsBuilder();
    bounds.path(segments, matrix);
    const box = bounds.finish();
    if (box !== null) this.painted.push(new Painted(segments, matrix, box, paint, span));
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
    const lines: Line[] = [];
    let smallest: number | null = null;
    let ownSize = false;
    for (const [child, base, up] of this.starts(doc, element)) {
      const tspan = doc.element(child)!;
      const line = context.line(tspan);
      if (line.hidden) continue;
      const lift = LINE_PROBE * (line.fontSize ?? DEFAULT_FONT_SIZE);
      const at = apply(m, [base[0] + lift * up[0], base[1] + lift * up[1]]);
      const lineFill = valueOf(tspan, NS_NONE, "fill") !== undefined;
      const lineSize = valueOf(tspan, NS_NONE, "font-size") !== undefined;
      // Il testo della riga e ogni pezzo, ciascuno col suo aspetto: senza i
      // caratteri non si sa dove cade un pezzo, e lo si guarda dove comincia
      // la riga.
      const words: string[] = [];
      const runs: Array<{ readonly look: Context; readonly words: string; readonly fill: boolean; readonly size: boolean }> = [];
      for (const part of doc.children(child)) {
        const node = doc.nodes[part]!;
        if (node.kind === "text") words.push(node.value);
        if (node.kind !== "element") continue;
        const piece: string[] = [];
        textContent(doc, part, piece);
        runs.push({
          look: line.line(node),
          words: piece.join(""),
          fill: lineFill || valueOf(node, NS_NONE, "fill") !== undefined,
          size: lineSize || valueOf(node, NS_NONE, "font-size") !== undefined,
        });
      }
      runs.unshift({ look: line, words: words.join(""), fill: lineFill, size: lineSize });
      for (const run of runs) {
        const look = run.look;
        if (look.hidden || collapse(run.words) === "") continue;
        const size = look.fontSize === null ? null : look.fontSize * scale;
        if (size !== null && (smallest === null || size < smallest)) {
          smallest = size;
          ownSize = run.size;
        }
        // Un testo di grandezza ignota conta come un testo normale.
        const large = size !== null && (size >= LARGE_TEXT || (look.bold && size >= LARGE_BOLD_TEXT));
        const fill = look.fillPaint();
        lines.push({ at, color: fill === "none" ? null : fill, threshold: large ? MIN_CONTRAST : MIN_TEXT_CONTRAST, own: run.fill });
      }
    }
    if (smallest !== null && smallest < MIN_TEXT_SIZE) {
      this.found.push(diagnostic("S013", span, shown(smallest)));
      this.sizes.push({ span, scale, line: ownSize });
    }
    if (lines.length > 0 && context.symbol === null) this.check(span, { kind: "text", lines });
  }

  /// Le righe di un testo, ognuna col punto dove comincia e la direzione in
  /// alto dei caratteri, lunga 1: i `tspan`, coi loro `x` e `dy`, o il
  /// `textPath`, nel punto di `startOffset` sul tracciato. Un testo su un
  /// tracciato lungo zero non ha righe.
  private starts(doc: XmlDocument, element: ElementNode): Array<[NodeId, Point, Point]> {
    const out: Array<[NodeId, Point, Point]> = [];
    const x = len(element, "x") ?? 0;
    let y = len(element, "y") ?? 0;
    for (const child of element.children) {
      const node = doc.element(child);
      if (node === null) continue;
      if (isSvg(node, "textPath")) {
        const d = followed(doc, element, this.paths);
        const offset = startOffset(valueOf(node, NS_NONE, "startOffset") ?? "0") ?? { value: 0, share: false };
        const found = d === null ? null : along(parsePath(d) ?? [], offset.value, offset.share);
        // Sopra il tracciato, nel suo verso, stanno i caratteri.
        if (found !== null) out.push([child, found.at, [found.direction[1], -found.direction[0]]]);
        return out;
      }
      if (!isSvg(node, "tspan")) continue;
      y += len(node, "dy") ?? 0;
      out.push([child, [len(node, "x") ?? x, y], [0, -1]]);
    }
    return out;
  }

  /// Chiude i controlli: S009 per ogni oggetto che contrasta poco col suo
  /// fondo, S017 per ogni colore di codice confuso con un altro, poi S012 e
  /// S013. `paper` è il colore della carta, `null` se non si sa; `boxes` il
  /// riquadro di ogni simbolo, nelle sue coordinate.
  finish(paper: Rgb | null, boxes: ReadonlyMap<string, Bounds | null>, diagnostics: Diagnostic[]): void {
    for (const [at, symbol, m] of this.instances) {
      const box = boxes.get(symbol) ?? null;
      if (box === null) continue;
      const shape = rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0);
      const bounds = new BoundsBuilder();
      bounds.path(shape, m);
      const covered = bounds.finish();
      if (covered !== null) this.painted[at] = new Painted(shape, m, covered, null, this.painted[at]!.span);
    }
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
    this.confused(paper, diagnostics);
    diagnostics.push(...this.found);
  }

  /// S017: i colori di codice che si distinguono da un altro soltanto per la
  /// tinta. Le aree si guardano in ordine di documento, come sono dipinte.
  private confused(paper: Rgb | null, diagnostics: Diagnostic[]): void {
    // I colori composti delle aree, in ordine di prima comparsa, con le loro
    // aree.
    const tints: Tint[] = [];
    const seen = new Map<number, Tint>();
    for (const painted of this.painted) {
      if (painted.paint === null || !painted.hasArea) continue;
      const [rgb, alpha] = painted.paint;
      // Una figura opaca ha il suo colore anche su una carta ignota.
      let color: Rgb;
      if (alpha >= 1) color = rgb;
      else if (paper !== null) color = over(rgb, alpha, paper);
      else continue;
      const id = (color[0] << 16) | (color[1] << 8) | color[2];
      let tint = seen.get(id);
      if (tint === undefined) {
        tint = { color, areas: [] };
        seen.set(id, tint);
        tints.push(tint);
      }
      tint.areas.push(painted.span);
    }
    const codes = tints.filter((tint) => tint.areas.length >= 2);
    if (codes.length > MAX_CODES) return;
    for (const tint of codes) {
      // Il compagno col contrasto più basso, e a parità il primo.
      let worst: { readonly other: Tint; readonly ratio: number } | null = null;
      for (const other of codes) {
        if (other === tint) continue;
        const ratio = contrast(tint.color, other.color);
        if (ratio < MIN_CONTRAST && (worst === null || ratio < worst.ratio)) worst = { other, ratio };
      }
      if (worst === null) continue;
      const first = tint.areas[0]!;
      diagnostics.push(diagnostic("S017", first, `${hex(tint.color)} ${hex(worst.other.color)} ${shown(worst.ratio)}`));
      this.confusions.push({ span: first, color: tint.color, partner: worst.other.color, ratio: worst.ratio, areas: tint.areas });
    }
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

/// Un colore come lo scrive il file: `#rrggbb`, in minuscolo.
function hex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
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
