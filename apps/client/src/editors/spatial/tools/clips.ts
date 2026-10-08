// Ciò che si vede di un oggetto ritagliato o mascherato: i ritagli e le
// maschere dicono dove l'oggetto si disegna davvero, e gli strumenti lo
// toccano, lo inquadrano e lo agganciano lì, non nel riquadro di ciò che
// contiene.
//
// Un ritaglio (`clipPath`) o una maschera (`mask`) ha un **contenuto**: forme
// e testi che stanno nelle coordinate dell'elemento che lo usa, dopo il suo
// `transform`, e che vi si muovono. Un ritaglio lascia vedere dove le sue
// forme riempiono; una maschera dove le sue forme dipingono, dentro la sua
// finestra: la luminanza non si legge, perché una forma nera conta come una
// bianca. Con `objectBoundingBox` il contenuto, e la finestra di una
// maschera, stanno nel riquadro della geometria dell'elemento, senza
// contorno: prima la matrice del riquadro, poi il `transform` del ritaglio.
//
// Questo modulo non legge il disegno: ha i tipi di ciò che il contenuto dà,
// e il calcolo dei riquadri e dei segmenti. La lettura delle risorse e le
// prove di contatto stanno in `hit.ts`.

import { BoundsBuilder, rectPath, type Bounds, type Segment } from "../scene/geometry";
import { compose, IDENTITY, type Matrix, type Point } from "../scene/matrix";

// ---------------------------------------------------------------------------
// Forme che si toccano.
// ---------------------------------------------------------------------------

/// Un sottotracciato appiattito, in coordinate della scena: `x, y` a coppie.
export interface Run {
  readonly points: Float64Array;
  readonly closed: boolean;
}

/// Una forma appiattita nella scena.
export interface Flat {
  readonly runs: readonly Run[];
  /// Metà dello spessore del contorno nella scena.
  readonly radius: number;
}

/// Il riquadro nella scena di una forma, ricordato per la matrice con cui è
/// stato misurato.
export interface SceneCache {
  scene: { readonly matrix: Matrix; readonly bounds: Bounds | null } | null;
}

/// Una forma che si tocca: i segmenti, la matrice dalle sue coordinate a
/// quelle della scena e come si dipinge.
export interface Solid {
  readonly segments: readonly Segment[];
  readonly matrix: Matrix;
  readonly fill: boolean;
  /// Metà dello spessore del contorno, in unità della forma; 0 senza contorno.
  readonly radius: number;
  /// Vero se il riempimento segue la regola `evenodd`; assente, `nonzero`.
  readonly evenodd?: boolean;
  readonly cache: SceneCache | null;
  flat: Flat | null;
}

// ---------------------------------------------------------------------------
// Il contenuto di un ritaglio o di una maschera.
// ---------------------------------------------------------------------------

/// Una forma del contenuto: i segmenti, la matrice dalle sue coordinate a
/// quelle del contenuto, e come conta. In un ritaglio conta l'area che
/// riempie, mai il contorno; in una maschera ciò che dipinge.
export interface ClipShape {
  readonly segments: readonly Segment[];
  readonly matrix: Matrix;
  readonly fill: boolean;
  readonly radius: number;
  /// Vero se il riempimento segue `clip-rule="evenodd"`.
  readonly evenodd: boolean;
}

/// La finestra di una maschera: `x`, `y`, `width` e `height`, o le loro
/// frazioni del riquadro dell'elemento con `box`.
export interface ClipWindow {
  readonly box: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Un ritaglio o una maschera letti dalla risorsa, per ogni elemento che la
/// usa.
export interface ClipLook {
  /// Vero per una maschera.
  readonly mask: boolean;
  /// Vero se il contenuto sta nel riquadro dell'elemento: `clipPathUnits` o
  /// `maskContentUnits` valgono `objectBoundingBox`.
  readonly boxContent: boolean;
  /// Il `transform` di un ritaglio; l'identità per una maschera.
  readonly transform: Matrix;
  /// La finestra di una maschera; `null` per un ritaglio, o per una maschera
  /// senza limiti scritti.
  readonly window: ClipWindow | null;
  /// Le forme del contenuto che contano, in ordine di documento.
  readonly shapes: readonly ClipShape[];
}

/// Vero se per mettere `look` sull'elemento serve il riquadro della sua
/// geometria.
export function needsBox(look: ClipLook): boolean {
  return look.boxContent || (look.window !== null && look.window.box);
}

// ---------------------------------------------------------------------------
// Riquadri.
// ---------------------------------------------------------------------------

export function sameMatrix(a: Matrix, b: Matrix): boolean {
  return a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5]);
}

/// Il fattore medio con cui `m` cambia le lunghezze: esatto per una
/// similitudine, una stima per una scala diversa sui due assi.
export function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export function transformedBounds(segments: readonly Segment[], m: Matrix): Bounds | null {
  const out = new BoundsBuilder();
  out.path(segments, m);
  return out.finish();
}

/// `bounds` allargato di `by` da ogni lato.
export function inflate(bounds: Bounds, by: number): Bounds {
  return by === 0 ? bounds : { min: [bounds.min[0] - by, bounds.min[1] - by], max: [bounds.max[0] + by, bounds.max[1] + by] };
}

/// Ciò che `a` e `b` hanno in comune; `null` se non si toccano. Un riquadro
/// che li tocca solo su un lato, o in un punto, è senza area ma c'è: così una
/// linea, che ha un'altezza di zero, non sparisce.
export function intersect(a: Bounds, b: Bounds): Bounds | null {
  const x0 = Math.max(a.min[0], b.min[0]);
  const y0 = Math.max(a.min[1], b.min[1]);
  const x1 = Math.min(a.max[0], b.max[0]);
  const y1 = Math.min(a.max[1], b.max[1]);
  return x0 > x1 || y0 > y1 ? null : { min: [x0, y0], max: [x1, y1] };
}

/// La parte del segmento da `a` a `b` che sta dentro `box` allargato di
/// `margin`: i due estremi, che sono quelli di prima se il segmento ci sta
/// tutto. `null` se nessuna parte ci sta. (Liang e Barsky.)
export function clipSegment(a: Point, b: Point, box: Bounds, margin: number): [Point, Point] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - (box.min[0] - margin), box.max[0] + margin - a[0], a[1] - (box.min[1] - margin), box.max[1] + margin - a[1]];
  let from = 0;
  let to = 1;
  for (let side = 0; side < 4; side++) {
    if (p[side] === 0) {
      if (q[side]! < 0) return null;
      continue;
    }
    const at = q[side]! / p[side]!;
    if (p[side]! < 0) {
      if (at > to) return null;
      if (at > from) from = at;
    } else {
      if (at < from) return null;
      if (at < to) to = at;
    }
  }
  if (from === 0 && to === 1) return [a, b];
  return [[a[0] + from * dx, a[1] + from * dy], [a[0] + to * dx, a[1] + to * dy]];
}

// ---------------------------------------------------------------------------
// Un ritaglio o una maschera sull'elemento che li usa.
// ---------------------------------------------------------------------------

/// Un ritaglio o una maschera messi sull'elemento che li usa: dove il
/// contenuto sta nella scena, e che cosa lascia vedere. Lo dividono tutte le
/// forme sotto lo stesso elemento: si legge, si misura e si appiattisce una
/// volta sola.
export class Clip {
  /// Vero se non lascia vedere niente: un contenuto che non disegna, o un
  /// riquadro senza misure dove ne serve uno.
  readonly empty: boolean;
  /// Dalle coordinate del contenuto a quelle dell'elemento.
  private readonly local: Matrix;
  /// La finestra di una maschera, nelle coordinate dell'elemento.
  private readonly rect: readonly Segment[] | null;
  private matrices: Matrix[] | null = null;
  private scene: Bounds | null | undefined = undefined;
  private content: Solid[] | null = null;
  private windowShape: Solid | null | undefined = undefined;

  /// `user` porta le coordinate dell'elemento nella scena; `box` è il
  /// riquadro della sua geometria nelle sue coordinate, che serve se
  /// [`needsBox`] lo dice.
  constructor(
    readonly look: ClipLook,
    readonly user: Matrix,
    box: Bounds | null,
  ) {
    let empty = look.shapes.length === 0;
    let bbox = IDENTITY;
    if (needsBox(look)) {
      const width = box === null ? 0 : box.max[0] - box.min[0];
      const height = box === null ? 0 : box.max[1] - box.min[1];
      if (box === null || !(width > 0) || !(height > 0)) empty = true;
      else bbox = [width, 0, 0, height, box.min[0], box.min[1]];
    }
    this.local = look.boxContent ? compose(look.transform, bbox) : look.transform;
    let rect: readonly Segment[] | null = null;
    const window = look.window;
    if (window !== null) {
      const x = window.box ? bbox[4] + bbox[0] * window.x : window.x;
      const y = window.box ? bbox[5] + bbox[3] * window.y : window.y;
      const w = window.box ? bbox[0] * window.width : window.width;
      const h = window.box ? bbox[3] * window.height : window.height;
      if (!(w > 0) || !(h > 0)) empty = true;
      else rect = rectPath(x, y, w, h, 0, 0);
    }
    this.rect = rect;
    this.empty = empty;
  }

  /// Il riquadro, in uno spazio che `m` porta dalle coordinate dell'elemento:
  /// dove il contenuto dipinge, nella finestra della maschera. `null` se non
  /// lascia vedere niente.
  areaIn(m: Matrix): Bounds | null {
    if (this.empty) return null;
    const out = new BoundsBuilder();
    const matrices = this.contentMatrices();
    this.look.shapes.forEach((shape, at) => {
      const matrix = compose(m, matrices[at]!);
      const bounds = transformedBounds(shape.segments, matrix);
      if (bounds === null) return;
      const inflated = inflate(bounds, shape.radius * scaleOf(matrix));
      out.include(inflated.min);
      out.include(inflated.max);
    });
    const box = out.finish();
    if (box === null || this.rect === null) return box;
    const window = transformedBounds(this.rect, m);
    return window === null ? null : intersect(box, window);
  }

  /// Il riquadro nella scena; `null` se non lascia vedere niente.
  sceneBox(): Bounds | null {
    if (this.scene === undefined) this.scene = this.areaIn(this.user);
    return this.scene;
  }

  /// Le forme del contenuto nella scena, per toccarle. Una volta sola.
  solids(): readonly Solid[] {
    if (this.content === null) {
      const matrices = this.contentMatrices();
      this.content = this.empty ? [] : this.look.shapes.map((shape, at) => solid(shape.segments, compose(this.user, matrices[at]!), shape.fill, shape.radius, shape.evenodd));
    }
    return this.content;
  }

  /// La finestra della maschera nella scena, come una forma da riempire;
  /// `null` per un ritaglio o una maschera senza limiti.
  windowSolid(): Solid | null {
    if (this.windowShape === undefined) this.windowShape = this.rect === null || this.empty ? null : solid(this.rect, this.user, true, 0, false);
    return this.windowShape;
  }

  /// Gruppi di forme dentro ognuno dei quali sta tutto ciò che si vede: il
  /// contenuto, e per una maschera anche la finestra.
  covers(): ReadonlyArray<readonly Solid[]> {
    if (this.empty) return [];
    const window = this.windowSolid();
    return window === null ? [this.solids()] : [[window], this.solids()];
  }

  private contentMatrices(): Matrix[] {
    this.matrices ??= this.look.shapes.map((shape) => compose(this.local, shape.matrix));
    return this.matrices;
  }
}

function solid(segments: readonly Segment[], matrix: Matrix, fill: boolean, radius: number, evenodd: boolean): Solid {
  return { segments, matrix, fill, radius, evenodd, cache: { scene: { matrix, bounds: transformedBounds(segments, matrix) } }, flat: null };
}

// ---------------------------------------------------------------------------
// La regione di un oggetto.
// ---------------------------------------------------------------------------

/// Dove si misura un riquadro: la scena, le coordinate dell'oggetto, o la
/// scena dopo la trasformazione `Matrix` dell'oggetto.
export type Space = "scene" | "frame" | Matrix;

/// Un ritaglio o una maschera che tagliano una forma di un oggetto.
export class Region {
  private framed: Bounds | null | undefined = undefined;
  private moved: { readonly matrix: Matrix; readonly bounds: Bounds | null } | null = null;

  /// `frame` porta le coordinate dell'elemento che usa il ritaglio in quelle
  /// dell'oggetto; `null` se non si sanno, e allora l'oggetto si misura nella
  /// scena. `follows` è vero se il ritaglio si muove con l'oggetto, perché è
  /// suo o di un suo discendente; falso se è di chi lo contiene, e resta
  /// dov'è quando l'oggetto si sposta.
  constructor(
    readonly clip: Clip,
    readonly frame: Matrix | null,
    readonly follows: boolean,
  ) {}

  /// Il riquadro di ciò che lascia vedere in `space`; `null` se niente.
  area(space: Space): Bounds | null {
    if (space === "scene") return this.clip.sceneBox();
    if (space === "frame") {
      if (this.frame === null) return this.clip.sceneBox();
      if (this.framed === undefined) this.framed = this.clip.areaIn(this.frame);
      return this.framed;
    }
    if (!this.follows) return this.clip.sceneBox();
    // Tutte le forme di un oggetto chiedono la stessa trasformazione di fila.
    if (this.moved === null || !sameMatrix(this.moved.matrix, space)) this.moved = { matrix: space, bounds: this.clip.areaIn(compose(space, this.clip.user)) };
    return this.moved.bounds;
  }
}

/// `box` tagliato da ogni regione di `regions` in `space`; `null` se non ne
/// resta niente.
export function cut(box: Bounds, regions: readonly Region[], space: Space): Bounds | null {
  let out: Bounds | null = box;
  for (const region of regions) {
    const area = region.area(space);
    if (area === null) return null;
    out = intersect(out, area);
    if (out === null) return null;
  }
  return out;
}
