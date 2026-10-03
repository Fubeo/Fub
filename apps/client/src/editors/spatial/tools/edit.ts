// Le operazioni che gli strumenti scrivono (operazioni sulla scena, §2): un
// gesto diventa un'operazione sola, o un `batch` quando gli servono più passi,
// così annulla e ripeti lo disfano intero.
//
// - **Dove si scrive.** Un oggetto nuovo va in cima al livello visibile e
//   sbloccato più in alto, coi punti portati nelle sue coordinate. Un
//   documento senza livelli scrive alla radice; un livello senza id ne
//   riceve uno con `ident` nello stesso `batch`. Se ogni livello è bloccato o
//   nascosto non si scrive.
// - **Spostare** cambia solo `transform`, mai la geometria: la matrice nuova
//   è la traslazione nelle coordinate del genitore composta con quella di
//   prima, scritta come un `matrix()` solo, e tolta se è l'identità. Lo
//   spostamento nella scena si arrotonda a due decimali come la geometria: in
//   un livello senza trasformazioni il file riceve numeri puliti.
// - **Ridimensionare** e collocare con numeri cambiano solo `transform`, allo
//   stesso modo: il riquadro della selezione va nel riquadro chiesto con una
//   scala e una traslazione nella scena, e il contorno scala con l'oggetto.
// - **Eliminare** toglie gli oggetti dall'ultimo al primo, così il percorso
//   di un oggetto senza id resta valido fino al suo turno.
// - **La pagina** si allarga a passi di 256 unità per lato quando un oggetto
//   ne esce, nello stesso `batch` dell'operazione che lo fa uscire, e non si
//   restringe mai (formato della scena, §2).

import { formatNumber } from "../number";
import { formatBrush, type Pf1Brush } from "../ink/brush";
import { encodeInk, inkFromQuantized } from "../ink/codec";
import type { QuantizedInk } from "../ink/sample";
import type { Bounds } from "../scene/geometry";
import { createId, type IdKind } from "../scene/ids";
import { apply, compose, IDENTITY, invert, translate, type Matrix } from "../scene/matrix";
import { ROOT, type AddOp, type Op } from "../scene/ops";
import { formatTransform, type Elem } from "../scene/serialize";
import type { Page } from "../painter/paint";
import type { SceneIndex, Unit } from "./hit";

/// Il passo con cui la pagina si allarga.
export const PAGE_STEP = 256;

const IDENTITY_TEXT = formatTransform(IDENTITY);

/// Gli id nuovi di un gesto: diversi da quelli del documento e fra loro.
export class NewIds {
  private readonly used = new Set<string>();

  constructor(private readonly taken: (id: string) => boolean) {}

  next(kind: IdKind): string {
    const id = createId(kind, (candidate) => this.used.has(candidate) || this.taken(candidate));
    this.used.add(id);
    return id;
  }
}

/// Dove uno strumento scrive un oggetto nuovo.
export interface Destination {
  /// Il genitore dell'`add`: l'id del livello, o `#root`.
  readonly parent: string;
  /// Dalle coordinate del livello a quelle della scena.
  readonly matrix: Matrix;
  /// Dalla scena alle coordinate del livello.
  readonly inverse: Matrix;
  /// Ciò che va fatto prima, nello stesso `batch`: l'`ident` di un livello
  /// senza id.
  readonly prelude: readonly Op[];
}

/// Il livello visibile e sbloccato più in alto; la radice se il documento non
/// ha livelli; `null` se ogni livello è bloccato o nascosto, o schiacciato da
/// una trasformazione che non si inverte.
export function destination(index: SceneIndex, ids: NewIds): Destination | null {
  if (index.layers.length === 0) return { parent: ROOT, matrix: IDENTITY, inverse: IDENTITY, prelude: [] };
  for (let i = index.layers.length - 1; i >= 0; i--) {
    const layer = index.layers[i]!;
    if (layer.locked || layer.hidden) continue;
    const inverse = invert(layer.matrix);
    if (inverse === null) continue;
    if (layer.id !== null) return { parent: layer.id, matrix: layer.matrix, inverse, prelude: [] };
    const id = ids.next("layer");
    return { parent: id, matrix: layer.matrix, inverse, prelude: [{ op: "ident", path: layer.path, tag: "g", id }] };
  }
  return null;
}

/// Un'operazione per un gesto: quella sola, o un `batch` di tutte.
export function gesture(ops: readonly Op[]): Op | null {
  if (ops.length === 0) return null;
  return ops.length === 1 ? ops[0]! : { op: "batch", ops };
}

/// L'`add` di un oggetto in cima al livello di `to`.
export function addOp(to: Destination, elem: Elem): AddOp {
  return { op: "add", parent: to.parent, pos: { last: true }, elem };
}

/// L'elemento di un tratto a penna (formato della scena, §5). Il `d` non si
/// scrive: il motore lo calcola da `fub:ink` e `fub:brush`.
export function strokeElem(id: string, color: string, brush: Pf1Brush, ink: QuantizedInk, at: string | null): Elem {
  const attrs: Record<string, string> = { id, "fub:tool": "pen" };
  if (at !== null) attrs["fub:at"] = at;
  attrs["fub:brush"] = formatBrush(brush);
  attrs.fill = color;
  attrs["fub:ink"] = encodeInk(inkFromQuantized(ink));
  return { tag: "path", attrs };
}

/// Lo spostamento nella scena come lo scrive il file: due decimali.
export function roundDelta(value: number): number {
  return Number(formatNumber(value, 2));
}

/// La matrice di `unit` spostato di (`dx`, `dy`) nella scena; `null` se il
/// genitore schiaccia il piano e nessuno spostamento lo raggiunge.
export function movedMatrix(unit: Unit, dx: number, dy: number): Matrix | null {
  const [a, b, c, d] = unit.parent;
  const linear = invert([a, b, c, d, 0, 0]);
  if (linear === null) return null;
  const [x, y] = apply(linear, [dx, dy]);
  return compose(translate(x, y), unit.transform);
}

/// Il valore di `transform` per `m`: `null`, cioè nessun attributo, per
/// l'identità.
export function transformValue(m: Matrix): string | null {
  const text = formatTransform(m);
  return text === IDENTITY_TEXT ? null : text;
}

/// Uno spostamento: le operazioni, e le chiavi degli oggetti dopo, che per
/// un oggetto senza id sono l'id che riceve.
export interface Moved {
  readonly ops: readonly Op[];
  readonly keys: readonly string[];
}

/// Le operazioni che spostano `units` di (`dx`, `dy`) nella scena.
export function moveOps(units: readonly Unit[], dx: number, dy: number, ids: NewIds): Moved {
  const ops: Op[] = [];
  const keys: string[] = [];
  for (const unit of units) {
    const m = movedMatrix(unit, dx, dy);
    if (m === null) continue;
    let id = unit.id;
    if (id === null) {
      id = ids.next("object");
      ops.push({ op: "ident", path: unit.path, tag: unit.tag, id });
    }
    ops.push({ op: "set", id, attrs: { transform: transformValue(m) } });
    keys.push(id);
  }
  return { ops, keys };
}

/// La matrice di `unit` dopo `m`, una trasformazione della scena, nelle
/// coordinate del genitore; `null` se il genitore schiaccia il piano.
export function transformedMatrix(unit: Unit, m: Matrix): Matrix | null {
  const inverse = invert(unit.parent);
  if (inverse === null) return null;
  return compose(inverse, compose(m, unit.matrix));
}

/// La scala e la traslazione della scena che portano il riquadro `from` in
/// `to`. Un lato che misura zero non scala: resta com'è, e si sposta soltanto.
export function boxMatrix(from: Bounds, to: Bounds): Matrix {
  const width = from.max[0] - from.min[0];
  const height = from.max[1] - from.min[1];
  const sx = width > 0 ? (to.max[0] - to.min[0]) / width : 1;
  const sy = height > 0 ? (to.max[1] - to.min[1]) / height : 1;
  return [sx, 0, 0, sy, to.min[0] - sx * from.min[0], to.min[1] - sy * from.min[1]];
}

/// Il riquadro `bounds` portato da `m`, una scala e una traslazione.
export function mappedBounds(bounds: Bounds, m: Matrix): Bounds {
  const [x1, y1] = apply(m, bounds.min);
  const [x2, y2] = apply(m, bounds.max);
  return { min: [Math.min(x1, x2), Math.min(y1, y2)], max: [Math.max(x1, x2), Math.max(y1, y2)] };
}

/// Le operazioni che applicano `m`, una trasformazione della scena, a
/// `units`; le chiavi come per lo spostamento.
export function transformOps(units: readonly Unit[], m: Matrix, ids: NewIds): Moved {
  const ops: Op[] = [];
  const keys: string[] = [];
  for (const unit of units) {
    const next = transformedMatrix(unit, m);
    if (next === null) continue;
    let id = unit.id;
    if (id === null) {
      id = ids.next("object");
      ops.push({ op: "ident", path: unit.path, tag: unit.tag, id });
    }
    ops.push({ op: "set", id, attrs: { transform: transformValue(next) } });
    keys.push(id);
  }
  return { ops, keys };
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/// Le operazioni che tolgono `units`, dall'ultimo al primo nel documento.
export function removeOps(units: readonly Unit[]): Op[] {
  return [...units].sort((a, b) => comparePaths(b.path, a.path)).map((unit) => ({ op: "remove", target: unit.target }));
}

/// Il `viewBox` della pagina che contiene anche `bounds`: ogni lato da cui
/// `bounds` esce si allarga di un multiplo di 256 unità. `null` se ci sta già,
/// o se il documento non ha una pagina. I bordi si arrotondano verso
/// l'esterno a due decimali: la pagina non perde nemmeno un centesimo.
export function pageFor(page: Page | null, bounds: Bounds | null): string | null {
  if (page === null || bounds === null) return null;
  const steps = (outside: number): number => (outside > 0 ? Math.ceil(outside / PAGE_STEP) * PAGE_STEP : 0);
  const left = steps(page.x - bounds.min[0]);
  const top = steps(page.y - bounds.min[1]);
  const right = steps(bounds.max[0] - (page.x + page.width));
  const bottom = steps(bounds.max[1] - (page.y + page.height));
  if (left + top + right + bottom === 0) return null;
  // Il margine tiene fermo un bordo che è già un centesimo esatto, come
  // `0.1 + 0.2`, che in virgola mobile ne sfora uno.
  const down = (v: number): number => Math.floor(v * 100 + 1e-6) / 100;
  const up = (v: number): number => Math.ceil(v * 100 - 1e-6) / 100;
  const minX = down(page.x - left);
  const minY = down(page.y - top);
  const maxX = up(page.x + page.width + right);
  const maxY = up(page.y + page.height + bottom);
  return [minX, minY, maxX - minX, maxY - minY].map((v) => formatNumber(v, 2)).join(" ");
}
