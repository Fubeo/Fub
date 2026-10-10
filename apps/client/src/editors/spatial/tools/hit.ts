// Gli oggetti che gli strumenti toccano: l'indice con cui la selezione
// sceglie, la gomma cancella e lo spostamento sposta.
//
// Un **oggetto** è ciò che al livello Essenziale si sceglie intero: un figlio
// di un livello, o un figlio della radice fuori da ogni livello, che non sia
// la carta, il titolo o la descrizione. Un oggetto fatto a un livello più
// ricco resta intatto anche qui, dove al massimo si sposta o si elimina
// intero. Un gruppo o un collegamento si sceglie con tutto ciò che contiene.
// Gli oggetti di un livello bloccato o nascosto non si toccano, e nemmeno
// quelli bloccati con `fub:locked="true"` o nascosti con `display="none"`.
// Un blocco estraneo non è un oggetto: si vede come immagine e resta com'è.
// Dentro un oggetto, però, conta nella sua geometria con una stima: le forme
// che SVG conosce, con le trasformazioni e gli attributi di presentazione,
// anche quelli del loro `style`, `display` e `visibility` compresi, e i
// riquadri di immagini, testi, documenti annidati e `use`. Ciò che un foglio di stile cambia non si legge. Così un
// gruppo che contiene disegni di un altro programma si tocca, si sceglie e
// si sposta dove lo si vede.
//
// Dentro un gruppo o un collegamento si sceglie anche un oggetto solo: con
// Ctrl o ⌘ col clic, o isolando il gruppo, che diventa l'unico posto dove si
// sceglie. L'indice dà gli oggetti in cima, quelli del gruppo isolato se ce
// n'è uno, e trova quelli più dentro quando servono, con le stesse regole:
// niente dentro un gruppo bloccato o nascosto.
//
// La geometria è quella che il painter disegna: gli attributi dipinti della
// stessa `PaintScene` (`PaintBuilder.shape` e `headInfo`), con le
// trasformazioni di livelli e gruppi composte. I tracciati si appiattiscono
// solo per gli oggetti vicini al puntatore, con un errore di 0,05 unità
// della scena, e un tratto a penna si tocca dentro il suo contorno pieno
// come lo riempie il browser, con la regola non zero. Un testo si tocca nel
// riquadro stimato delle sue righe: la misura vera dipende dai caratteri.
// I marcatori di un tracciato, come le punte delle linee, si disegnano sopra
// la forma che li usa: si toccano come il suo contorno e stanno nei riquadri
// col contorno, ma non nella geometria che la griglia aggancia.
//
// Un'istanza di un simbolo si tocca dove si vede il contenuto del simbolo,
// portato dalla sua trasformazione, anche attraverso le istanze che il
// contenuto ha a sua volta. Le forme del contenuto non si modificano da lì:
// per gli strumenti che cambiano una forma l'istanza è una forma sola, che
// non ha nodi. Un oggetto tocca al più [`MAX_INSTANCE_PARTS`] forme
// attraverso le istanze: oltre, un'istanza si tocca nel riquadro del suo
// simbolo, così un file con simboli annidati non costa all'indice più del
// disegno che mostra.
//
// Una copia in una ripetizione si tocca dove si vede l'originale, portato
// dalla sua trasformazione, e come un'istanza è una forma sola che non ha
// nodi. Non è un oggetto: nella ripetizione isolata non si sceglie, e un
// clic dove si vede dà il suo originale. Oltre [`MAX_INSTANCE_PARTS`] forme
// nell'oggetto, una copia si tocca nel riquadro dell'originale.
//
// Di un oggetto ritagliato o mascherato conta ciò che si vede: le forme
// disegnate, tagliate dai ritagli e dalle maschere che le riguardano, cioè
// quelli dell'oggetto e di ciò che contiene, quelli del gruppo in cui lo si
// sceglie e quelli del suo livello. Riquadri, cornice, geometria, contatto,
// gomma e lazo li usano tutti così: un'immagine ritagliata si sceglie, si
// aggancia e si inquadra dove si vede, e le parti nascoste non prendono i
// clic. Il contenuto di un ritaglio conta dove riempie, quello di una
// maschera dove dipinge, qualunque colore abbia: la luminanza non si legge
// (`clips.ts`). Un oggetto che non si vede più non ha riquadro, ma si trova
// ancora dall'albero.

import type { Role } from "../scene/analysis";
import { BoundsBuilder, fmin, parsePath, rectPath, Track, type Bounds, type Segment } from "../scene/geometry";
import { arcCenter, onEllipse } from "../scene/curves";
import { markerFit, markerMatrix, placed, vertices, type MarkerFit, type MarkerPlace, type Vertex } from "../scene/markers";
import { apply, compose, IDENTITY, invert, translate, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, originalOf, parseFragment, tagName, type ContainerNode, type DocumentModel, type ElementPart, type Fragment, type LeafNode } from "../scene/model";
import type { Target } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { fraction, length, letterSpacing, nonNegativeLength, numberList, points as parsePoints, reference, startOffset, transform as parseTransform } from "../scene/values";
import { NS_NONE, NS_SVG, NS_XLINK, valueOf, type ElementNode, type NodeId, type XmlDocument } from "../scene/xml";
import type { PaintAttr, PaintBuilder, PaintDef, PaintNode, PaintResource, PaintScene, PaintShape, TextPiece, TextRun } from "../painter/paint";
import {
  Clip,
  clipSegment,
  cut,
  inflate,
  needsBox,
  Region,
  sameMatrix,
  scaleOf,
  transformedBounds,
  type ClipLook,
  type ClipShape,
  type ClipWindow,
  type Flat,
  type Run,
  type SceneCache,
  type Solid,
  type Space,
} from "./clips";

/// L'errore massimo dell'appiattimento, in unità della scena.
export const FLATNESS = 0.05;

/// Il limite di pezzi per una curva: oltre, una curva enorme costerebbe più
/// di quanto il puntatore possa distinguere.
const MAX_STEPS = 256;

/// Quante forme al più tocca un oggetto attraverso le istanze dei simboli:
/// oltre, un'istanza si tocca nel riquadro del suo simbolo. Cento istanze di
/// un simbolo con cento istanze sarebbero diecimila forme.
export const MAX_INSTANCE_PARTS = 4096;

/// Quanti simboli uno dentro l'altro si attraversano: più dentro, un'istanza
/// non si tocca. Una catena così lunga non è un disegno.
const MAX_SYMBOL_DEPTH = 64;

/// Un livello del documento, per chi deve scegliere dove scrivere.
export interface LayerInfo {
  readonly id: string | null;
  readonly path: readonly number[];
  /// Il nome scritto in `fub:layer`.
  readonly name: string;
  readonly locked: boolean;
  readonly hidden: boolean;
  /// Dalle coordinate del livello a quelle della scena.
  readonly matrix: Matrix;
}

/// Come si vede un testo, per chi lo modifica sul posto: nelle coordinate
/// dell'oggetto, con lo stile che eredita.
export interface TextLook {
  /// Il punto della linea di base della prima riga dove la riga comincia,
  /// sta al centro o finisce, secondo `anchor`.
  readonly x: number;
  readonly y: number;
  /// Il corpo, e il passo fra una riga e l'altra.
  readonly size: number;
  readonly leading: number;
  readonly anchor: "start" | "middle" | "end";
  /// `font-family`, `font-weight` e `fill` come li eredita; `null` se nessuno
  /// li scrive.
  readonly family: string | null;
  readonly weight: string | null;
  readonly color: string | null;
  /// La larghezza del riquadro di un testo in area, che ci va a capo
  /// dentro; `null` per gli altri.
  readonly wrap: number | null;
  /// La direzione del tracciato, lunga 1, dove comincia un testo su
  /// tracciato, che `x` e `y` sono quel punto; `null` per gli altri.
  readonly along: Point | null;
}

/// Un pezzo di un oggetto che si disegna da solo: una forma. Ha la
/// geometria e il modo di dipingersi di [`Solid`]: `matrix` porta le sue
/// coordinate nella scena, `radius` è metà del contorno nelle sue unità.
interface Part extends Solid {
  /// L'elemento che la disegna.
  readonly leaf: LeafNode;
  /// Dalle coordinate della forma a quelle dell'oggetto.
  readonly frameMatrix: Matrix;
  readonly cache: ShapeCache | null;
  /// Per un marcatore, come la punta di una linea, la forma che lo usa;
  /// `null` per una forma. Un marcatore si tocca e sta nei riquadri col
  /// contorno, ma non è geometria della forma: si vede come il suo contorno.
  readonly host: Part | null;
  /// I ritagli e le maschere che la tagliano, quelli di chi la contiene
  /// compresi; `null` se nessuno, e allora si vede tutta.
  readonly regions: readonly Region[] | null;
  /// Per una forma del contenuto di un simbolo, l'istanza dell'oggetto
  /// attraverso cui si vede, e per una dell'originale di una copia la copia;
  /// `null` per le altre.
  readonly via: Via | null;
}

/// L'istanza di un simbolo attraverso cui si tocca una forma del suo
/// contenuto, o la copia attraverso cui si tocca l'originale: la più esterna
/// nell'oggetto, con la matrice dalle sue coordinate a quelle della scena.
interface Via {
  readonly leaf: LeafNode;
  readonly matrix: Matrix;
}

/// Il contenuto di un simbolo, misurato una volta: quante forme dà, a
/// cascata, e il riquadro della sua geometria nelle sue coordinate.
interface SymbolInfo {
  readonly parts: number;
  readonly box: Bounds | null;
  /// I simboli che il contenuto usa, a cascata, col gruppo che li dipingeva
  /// quando si è misurato: se uno cambia, si misura di nuovo.
  readonly uses: ReadonlyMap<ContainerNode, PaintNode | undefined>;
  /// Per un simbolo che non si dipinge vivo, la scena in cui si è misurato:
  /// il suo gruppo non segue ciò che ha di estraneo. `null` per uno vivo.
  readonly scene: PaintScene | null;
}

/// Ciò che si vede di un oggetto in un punto: la forma, la sua geometria e
/// la matrice dalle sue coordinate a quelle della scena, e se lì si vede il
/// suo contorno o il suo riempimento.
export interface Sampled {
  readonly leaf: LeafNode;
  readonly segments: readonly Segment[];
  readonly matrix: Matrix;
  readonly on: "fill" | "stroke";
}

/// Ciò che di una forma non cambia finché non cambia la forma: i segmenti, e
/// il riquadro nella scena dell'ultima matrice.
interface ShapeCache extends SceneCache {
  segments: readonly Segment[] | null;
  local: Bounds | null | undefined;
  /// I vertici, dove vanno i marcatori.
  vertices?: readonly Vertex[];
}

/// Un blocco estraneo fuori dagli oggetti, con le forme che se ne stimano.
export class ForeignBlock {
  constructor(
    /// Il percorso nel documento.
    readonly path: readonly number[],
    private readonly parts: readonly Part[],
  ) {}

  /// Vero se il blocco si vede nel punto `p` della scena, entro `tolerance`.
  covers(p: Point, tolerance: number): boolean {
    return this.parts.some((part) => partSample(part, p, tolerance) !== null);
  }
}

/// Un oggetto della scena.
export class Unit {
  private frameBounds: Bounds | null | undefined = undefined;
  private shapeBounds: Bounds | null | undefined = undefined;

  constructor(
    /// L'id, o il percorso per un oggetto che non ne ha: la chiave della
    /// selezione.
    readonly key: string,
    readonly target: Target,
    readonly id: string | null,
    readonly path: readonly number[],
    readonly tag: string,
    readonly role: Role,
    /// L'id del livello che lo contiene; `null` alla radice o per un livello
    /// senza id.
    readonly layer: string | null,
    /// Dalle coordinate del genitore a quelle della scena.
    readonly parent: Matrix,
    /// Il suo `transform`, letto; l'identità se non ce l'ha.
    readonly transform: Matrix,
    /// Ciò che il painter disegna per lui.
    readonly paints: readonly PaintNode[],
    /// Il riquadro nella scena di ciò che si vede, contorno compreso; `null`
    /// se non disegna niente, o se ritagli e maschere lo nascondono tutto.
    readonly bounds: Bounds | null,
    /// Il riquadro nella scena della geometria che si vede, senza contorno:
    /// quello che la griglia aggancia.
    readonly geometry: Bounds | null,
    private readonly parts: readonly Part[],
    /// L'elemento.
    readonly node: ElementPart,
    /// Lo stile che trasmette ai figli.
    readonly inner: Style,
    /// Come si vede, se è un testo.
    readonly look: TextLook | null = null,
  ) {}

  /// Dalle coordinate dell'oggetto a quelle della scena.
  get matrix(): Matrix {
    return compose(this.parent, this.transform);
  }

  /// Il riquadro di ciò che si vede nelle coordinate dell'oggetto, contorno
  /// compreso: con `matrix` dà la cornice della selezione, che ruota con
  /// l'oggetto. Un'immagine ritagliata ha la cornice sul ritaglio, ruotato
  /// con lei.
  frame(): Bounds | null {
    if (this.frameBounds === undefined) {
      const out = new BoundsBuilder();
      for (const part of this.parts) {
        const local = part.frameMatrix === IDENTITY && part.cache !== null ? localBounds(part) : transformedBounds(part.segments, part.frameMatrix);
        if (local !== null) includeSeen(out, part, local, part.radius * scaleOf(part.frameMatrix), "frame");
      }
      this.frameBounds = out.finish();
    }
    return this.frameBounds;
  }

  /// Il riquadro della geometria che si vede nelle coordinate dell'oggetto,
  /// senza contorno: quello che la griglia aggancia quando la cornice non
  /// ruota, e che dice se un asse dell'oggetto misura zero.
  shapeFrame(): Bounds | null {
    if (this.shapeBounds === undefined) {
      const out = new BoundsBuilder();
      for (const part of this.parts) {
        if (part.host !== null) continue;
        const local = part.frameMatrix === IDENTITY && part.cache !== null ? localBounds(part) : transformedBounds(part.segments, part.frameMatrix);
        if (local !== null) includeSeen(out, part, local, 0, "frame");
      }
      this.shapeBounds = out.finish();
    }
    return this.shapeBounds;
  }

  /// Il riquadro di ciò che si vede nella scena dopo `m`, una
  /// trasformazione della scena, contorno compreso: dove finisce l'oggetto,
  /// anche ruotato. I ritagli e le maschere dell'oggetto e di ciò che
  /// contiene si muovono con lui; quelli di chi lo contiene restano dove
  /// sono.
  boundsAfter(m: Matrix): Bounds | null {
    const out = new BoundsBuilder();
    for (const part of this.parts) {
      const matrix = compose(m, part.matrix);
      const bounds = transformedBounds(part.segments, matrix);
      if (bounds !== null) includeSeen(out, part, bounds, part.radius * scaleOf(matrix), m);
    }
    return out.finish();
  }

  /// Vero se un ritaglio o una maschera taglia una delle sue forme: allora
  /// si vede, e si tocca, meno di quanto disegna.
  get clipped(): boolean {
    return this.parts.some((part) => part.regions !== null);
  }

  /// Vero se una delle forme che lo disegnano si riempie.
  get filled(): boolean {
    return this.parts.some((part) => part.host === null && part.fill);
  }

  /// Le forme che disegnano l'oggetto, in ordine di documento: l'elemento,
  /// e la matrice dalle sue coordinate a quelle della scena. I marcatori non
  /// ci sono: stanno con la forma che li usa. Un'istanza di un simbolo è una
  /// forma sola: il contenuto si cambia nel simbolo.
  shapes(): Array<{ readonly leaf: LeafNode; readonly matrix: Matrix }> {
    const out: Array<{ readonly leaf: LeafNode; readonly matrix: Matrix }> = [];
    for (const part of this.parts) {
      if (part.host !== null) continue;
      const via = part.via;
      if (via === null) out.push({ leaf: part.leaf, matrix: part.matrix });
      else if (out[out.length - 1]?.leaf !== via.leaf) out.push({ leaf: via.leaf, matrix: via.matrix });
    }
    return out;
  }

  /// Vero se il punto `p` della scena tocca l'oggetto, con una tolleranza
  /// `tolerance` in unità della scena: se cade su una forma, in un punto che
  /// ritagli e maschere lasciano vedere.
  hits(p: Point, tolerance: number): boolean {
    if (!near(this.bounds, p, p, tolerance)) return false;
    return this.parts.some((part) => partHits(part, p, tolerance));
  }

  /// La forma più in alto dell'oggetto che il punto `p` della scena tocca:
  /// per il contenuto di un simbolo, la sua istanza. `null` se nessuna.
  shapeAt(p: Point, tolerance: number): LeafNode | null {
    if (!near(this.bounds, p, p, tolerance)) return null;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const part = this.parts[i]!;
      if (partHits(part, p, tolerance)) return part.via?.leaf ?? part.leaf;
    }
    return null;
  }

  /// La forma più in alto dell'oggetto che si vede nel punto `p` della
  /// scena, e che cosa la colora lì: il contorno, che sta sopra, o il
  /// riempimento. Con `tolerance` un punto vicino a un bordo prende il
  /// contorno della forma, o il riempimento se non ne ha. Un marcatore, come
  /// la punta di una linea, dà il contorno della forma che lo usa. Con
  /// `below`, una sua forma, soltanto fra quelle che le stanno sotto. `null`
  /// se nessuna forma lo copre.
  sampleAt(p: Point, tolerance: number, below: LeafNode | null = null): Sampled | null {
    if (!near(this.bounds, p, p, tolerance)) return null;
    const top = below === null ? this.parts.length : this.parts.findIndex((part) => part.leaf === below);
    for (let i = top - 1; i >= 0; i--) {
      const part = this.parts[i]!;
      const on = partSample(part, p, tolerance);
      if (on === null) continue;
      // Un marcatore si vede come il contorno della forma che lo usa.
      const host = part.host;
      return host === null
        ? { leaf: part.leaf, segments: part.segments, matrix: part.matrix, on }
        : { leaf: host.leaf, segments: host.segments, matrix: host.matrix, on: "stroke" };
    }
    return null;
  }

  /// Vero se il segmento da `a` a `b` tocca l'oggetto: il passaggio della
  /// gomma fra due campioni. Sulla parte che un ritaglio nasconde la gomma
  /// passa senza toccare.
  touches(a: Point, b: Point, tolerance: number): boolean {
    if (!near(this.bounds, a, b, tolerance)) return false;
    return this.parts.some((part) => partTouches(part, a, b, tolerance));
  }

  /// Vero se ciò che si vede dell'oggetto sta tutto dentro il lazo `lasso`,
  /// contorno compreso: nessun contorno arriva a un lato del lazo, e ogni
  /// forma comincia dentro. Di una forma tagliata basta che stia dentro lei,
  /// o ciò che la taglia: ciò che si vede sta in tutti e due.
  inside(lasso: Lasso): boolean {
    const bounds = this.bounds;
    if (bounds === null || !holds(lasso.bounds, bounds)) return false;
    const edges = lasso.edgesNear(bounds);
    // Un riquadro che nessun lato attraversa sta tutto da una parte.
    if (edges.length === 0) return lasso.contains(bounds.min);
    for (const part of this.parts) {
      if (part.regions === null ? !solidInside(part, lasso, edges) : !visibleInside(part, lasso)) return false;
    }
    return true;
  }
}

/// Un lazo: un poligono della scena chiuso dall'ultimo punto al primo, che
/// contiene i punti con la regola non zero, come un riempimento. Un giro che
/// si chiude ripassando sull'inizio non lascia buchi.
class Lasso {
  readonly bounds: Bounds;
  private readonly flat: Flat;

  constructor(points: readonly Point[]) {
    const out = new BoundsBuilder();
    const coords = new Float64Array(points.length * 2);
    points.forEach((p, i) => {
      coords[2 * i] = p[0];
      coords[2 * i + 1] = p[1];
      out.include(p);
    });
    this.bounds = out.finish()!;
    this.flat = { runs: [{ points: coords, closed: true }], radius: 0 };
  }

  contains(p: Point): boolean {
    return winding(this.flat, p) !== 0;
  }

  /// I lati il cui riquadro incontra `bounds`, quattro numeri per lato.
  edgesNear(bounds: Bounds): number[] {
    const out: number[] = [];
    forEachEdge(this.flat, true, (ax, ay, bx, by) => {
      if (Math.max(ax, bx) >= bounds.min[0] && Math.min(ax, bx) <= bounds.max[0] && Math.max(ay, by) >= bounds.min[1] && Math.min(ay, by) <= bounds.max[1]) {
        out.push(ax, ay, bx, by);
      }
      return false;
    });
    return out;
  }
}

/// Come l'indice trova gli oggetti dentro i gruppi.
interface Nested {
  /// L'oggetto di chiave `key` dove si sceglie, a qualunque profondità;
  /// `null` se non c'è.
  resolve(key: string): Unit | null;
  /// Gli oggetti che si scelgono fra i figli di `container`.
  childrenOf(container: ContainerNode): Unit[];
  /// Il contenitore isolato come oggetto; `null` senza, o se lì non si
  /// sceglie.
  scopeUnit(): Unit | null;
  /// Il contenitore isolato; `null` senza.
  readonly scope: ContainerNode | null;
  /// Le copie fra i figli di `container`, se è una ripetizione dove si
  /// sceglie, come oggetti: non si scelgono, ma dicono dove si vedono.
  copiesOf(container: ContainerNode): Unit[];
}

/// L'indice degli oggetti di una scena, in ordine di documento: l'ultimo è
/// quello che si vede sopra. Gli oggetti dell'indice sono quelli in cima, o
/// quelli del gruppo isolato; quelli più dentro si trovano con `get`,
/// `children` e `deepAt`.
export class SceneIndex {
  private readonly byKey: Map<string, Unit | null>;
  private readonly top: ReadonlySet<Unit>;

  private scoped: Unit | null | undefined;

  constructor(
    readonly units: readonly Unit[],
    readonly layers: readonly LayerInfo[],
    private readonly nested: Nested | null = null,
  ) {
    this.byKey = new Map(units.map((unit) => [unit.key, unit]));
    this.top = new Set(units);
  }

  /// Il gruppo, il collegamento o il simbolo isolato come oggetto, che
  /// riceve ciò che si disegna: per un simbolo, nelle coordinate
  /// dell'istanza da cui lo si modifica. `null` senza isolamento.
  scope(): Unit | null {
    if (this.scoped === undefined) this.scoped = this.nested?.scopeUnit() ?? null;
    return this.scoped;
  }

  /// L'oggetto di chiave `key`, anche dentro un gruppo; `null` se non si
  /// sceglie: se non c'è, se è bloccato o nascosto, se lo è un gruppo che lo
  /// contiene, o se sta fuori dal gruppo isolato.
  get(key: string): Unit | null {
    let unit = this.byKey.get(key);
    if (unit === undefined) {
      unit = this.nested?.resolve(key) ?? null;
      this.byKey.set(key, unit);
    }
    return unit;
  }

  /// Gli oggetti che si scelgono fra i figli di `unit`, se è un gruppo o un
  /// collegamento, in ordine di documento.
  children(unit: Unit): Unit[] {
    if (unit.node.kind !== "container" || this.nested === null) return [];
    return this.nested.childrenOf(unit.node).map((child) => this.keep(child));
  }

  /// Gli oggetti che si scelgono accanto a `unit`, nello stesso genitore, lui
  /// compreso, in ordine di documento.
  siblings(unit: Unit): Unit[] {
    const parent = unit.node.parent;
    if (this.top.has(unit) || parent === null || this.nested === null) return this.units.filter((each) => each.node.parent === parent);
    return this.nested.childrenOf(parent).map((child) => this.keep(child));
  }

  /// Lo stesso oggetto di prima, se l'indice l'ha già dato: così una chiave
  /// dà sempre lo stesso oggetto.
  private keep(unit: Unit): Unit {
    const known = this.byKey.get(unit.key);
    if (known !== undefined && known !== null && known.node === unit.node) return known;
    this.byKey.set(unit.key, unit);
    return unit;
  }

  /// L'oggetto più in alto sotto `p`. In una ripetizione isolata, una copia
  /// che sta sopra dà il suo originale.
  at(p: Point, tolerance: number): Unit | null {
    let found: Unit | null = null;
    for (let i = this.units.length - 1; i >= 0 && found === null; i--) if (this.units[i]!.hits(p, tolerance)) found = this.units[i]!;
    const scope = this.nested?.scope ?? null;
    return scope === null ? found : this.throughCopies(scope, p, tolerance, found);
  }

  /// L'oggetto più dentro sotto `p`: in quello più in alto, il figlio più in
  /// alto che `p` tocca, e così via finché non ci sono figli da scegliere.
  /// In una ripetizione una copia dà il suo originale.
  deepAt(p: Point, tolerance: number): Unit | null {
    let unit = this.at(p, tolerance);
    while (unit !== null) {
      const children = this.children(unit);
      let inner: Unit | null = null;
      for (let i = children.length - 1; i >= 0 && inner === null; i--) if (children[i]!.hits(p, tolerance)) inner = children[i]!;
      if (unit.node.kind === "container") inner = this.throughCopies(unit.node, p, tolerance, inner);
      if (inner === null) return unit;
      unit = inner;
    }
    return null;
  }

  /// L'originale della copia più in alto di `container` che `p` tocca, se
  /// sta sopra `found`, un figlio di `container`; altrimenti `found`.
  private throughCopies(container: ContainerNode, p: Point, tolerance: number, found: Unit | null): Unit | null {
    const copies = this.nested?.copiesOf(container) ?? [];
    for (let i = copies.length - 1; i >= 0; i--) {
      const copy = copies[i]!;
      if (found !== null && !later(copy.path, found.path)) break;
      if (!copy.hits(p, tolerance)) continue;
      const original = this.get(copy.node.details!.original!);
      return original !== null && original.node.parent === container ? original : found;
    }
    return found;
  }

  /// Gli oggetti che il segmento da `a` a `b` tocca, in ordine di documento.
  along(a: Point, b: Point, tolerance: number): Unit[] {
    return this.units.filter((unit) => unit.touches(a, b, tolerance));
  }

  /// Gli oggetti che stanno interi dentro il lazo `points`, un poligono della
  /// scena chiuso dall'ultimo punto al primo: la stessa regola del riquadro
  /// di selezione.
  inside(points: readonly Point[]): Unit[] {
    if (points.length < 3) return [];
    const lasso = new Lasso(points);
    return this.units.filter((unit) => unit.inside(lasso));
  }

  /// Gli oggetti che stanno interi dentro `area`, un rettangolo della scena.
  within(area: Bounds): Unit[] {
    return this.units.filter((unit) => unit.bounds !== null
      && unit.bounds.min[0] >= area.min[0] && unit.bounds.max[0] <= area.max[0]
      && unit.bounds.min[1] >= area.min[1] && unit.bounds.max[1] <= area.max[1]);
  }
}

/// Lo stile che un contenitore trasmette ai figli, per quanto serve a
/// toccarli e a modificarne il testo.
interface Style {
  readonly fill: boolean;
  readonly stroke: boolean;
  readonly strokeWidth: number;
  readonly fontSize: number;
  /// `letter-spacing`, in unità utente.
  readonly spacing: number;
  readonly anchor: string;
  readonly family: string | null;
  readonly weight: string | null;
  readonly color: string | null;
}

/// Chi riceve gli oggetti di un documento: il nodo, il suo percorso, il
/// livello, la matrice e lo stile del genitore, e i ritagli e le maschere di
/// chi lo contiene.
type Visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null) => void;

/// Chi riceve i blocchi estranei fuori dagli oggetti: il blocco, la matrice
/// e lo stile del genitore, il suo percorso, e i ritagli e le maschere del
/// genitore.
type ForeignVisit = (leaf: LeafNode, parent: Matrix, style: Style, path: readonly number[], clips: readonly Clip[] | null) => void;

const INITIAL: Style = { fill: true, stroke: false, strokeWidth: 1, fontSize: 16, spacing: 0, anchor: "start", family: null, weight: null, color: null };

/// L'elemento che porta un id nel documento indicizzato, o il blocco
/// estraneo che lo contiene: ciò a cui rimanda un `use` estraneo.
export type Holder = (id: string) => ElementPart | null;

/// Costruisce gli indici di un documento, ricordando la geometria delle
/// forme che non cambiano fra una scena e l'altra.
export class SceneIndexer {
  private cache = new WeakMap<PaintShape, ShapeCache>();
  private tracks = new WeakMap<PaintResource, Track | null>();
  private markers = new WeakMap<PaintResource, MarkerLook | null>();
  private looks = new WeakMap<PaintResource, ClipLook | null>();
  /// Il contenuto dei simboli, per gruppo dipinto: il gruppo cambia quando
  /// cambia il contenuto.
  private symbolInfos = new WeakMap<PaintNode, SymbolInfo>();
  /// Il riquadro degli originali delle copie, per nodo dipinto.
  private originalBoxes = new WeakMap<PaintNode, Bounds | null>();
  /// Quanti simboli si stanno attraversando, uno dentro l'altro.
  private depth = 0;
  /// Mentre si misura un simbolo, quelli che il suo contenuto usa.
  private reached: Map<ContainerNode, PaintNode | undefined> | null = null;
  private readonly foreign: ForeignShapes;

  /// `holder` trova gli elementi a cui i blocchi estranei rimandano; senza,
  /// un `use` vede solo il blocco in cui sta.
  ///
  /// `pages`, nelle annotazioni di un PDF, dà i gruppi della pagina che si
  /// annota: sono i soli figli della radice che contano, trattati come
  /// livelli che si scrivono, per l'indice e per ogni altra ricerca.
  constructor(
    private readonly builder: PaintBuilder,
    private readonly holder: Holder | null = null,
    private readonly pages: ((model: DocumentModel) => readonly ContainerNode[]) | null = null,
  ) {
    this.foreign = new ForeignShapes(builder, holder);
  }

  /// L'indice di `model`, che il `PaintBuilder` ha appena disegnato. Con
  /// `scope`, un gruppo o un collegamento isolato, gli oggetti sono i suoi
  /// figli, e fuori non si sceglie niente.
  ///
  /// `through` sono le istanze da cui si entra nei simboli, dalla più
  /// esterna: il contenuto di un simbolo sta nelle coordinate dell'istanza,
  /// con lo stile e i ritagli che lei gli dà. Così si isola un simbolo, o un
  /// gruppo del suo contenuto.
  index(model: DocumentModel, scope: ContainerNode | null = null, through: readonly LeafNode[] = []): SceneIndex {
    const units: Unit[] = [];
    const layers: LayerInfo[] = [];
    const nested = new Lookup(
      model,
      scope,
      through,
      this.rootStyle(model),
      (node) => this.attrsOf(node),
      (node, path, layer, parent, style, clips) => this.unit(node, path, layer, parent, style, clips),
      (node, attrs, matrix, style, outer) => this.clipsOf(node, attrs, matrix, style, outer),
      this.pagesOf(model),
    );
    if (scope === null) {
      this.walk(model, (layer) => !layer.locked && !layer.hidden, layers, (node, path, layer, parent, style, clips) => {
        if (node.details!.locked === true) return;
        push(units, this.unit(node, path, layer, parent, style, clips));
      });
    } else {
      this.walk(model, () => false, layers, () => {});
      units.push(...nested.childrenOf(scope));
    }
    return new SceneIndex(units, layers, nested);
  }

  /// Il riquadro nella scena di `elem`, la forma che uno strumento scrive al
  /// posto di `leaf`, come [`elemBounds`], con le punte che nomina, lette
  /// fra le risorse del documento di `leaf`: come lo avrà la forma scritta.
  writtenBounds(elem: Elem, matrix: Matrix, leaf: LeafNode): Bounds | null {
    const bounds = elemBounds(elem, matrix);
    const attrs: PaintAttr[] = Object.entries(elem.attrs);
    if (bounds === null || !MARKED.has(elem.tag) || MARKER_PROPERTIES.every(([, name]) => attr(attrs, name) === undefined)) return bounds;
    const style = styleOf(INITIAL, attrs);
    const host: Part = { leaf, segments: elemSegments(elem, attrs, style), matrix, frameMatrix: matrix, fill: false, radius: 0, cache: null, flat: null, host: null, regions: null, via: null };
    const tips: Part[] = [];
    this.tips(host, attrs, style, tips);
    const out = new BoundsBuilder();
    includeInflated(out, bounds, 0);
    for (const part of tips) {
      const local = transformedBounds(part.segments, part.matrix);
      if (local !== null) includeInflated(out, local, part.radius * scaleOf(part.matrix));
    }
    return out.finish();
  }

  /// Vero se dentro `container`, un gruppo, un collegamento o un simbolo di
  /// `model`, si sceglie: se sta nel documento, e né lui né chi lo contiene
  /// è bloccato o nascosto. In un simbolo si entra soltanto da un'istanza di
  /// `through`, come per [`index`], che si veda e non sia bloccata.
  opens(model: DocumentModel, container: ContainerNode, through: readonly LeafNode[] = []): boolean {
    const role = container.details?.role;
    if (role !== "group" && role !== "link" && role !== "symbol") return false;
    return new Lookup(model, null, through, this.rootStyle(model), (node) => this.attrsOf(node), () => null, (_node, _attrs, _matrix, _style, outer) => outer, this.pagesOf(model)).contextOf(container) !== null;
  }

  /// I collegamenti di `model` che si vedono, a ogni profondità: anche
  /// quelli dentro un gruppo, e quelli dei livelli bloccati che l'indice non
  /// tocca, perché un collegamento si apre anche lì. La chiave di uno dentro
  /// un gruppo non è una chiave della selezione.
  ///
  /// Un collegamento nel contenuto di un simbolo si apre da ogni istanza, e
  /// c'è una volta per istanza, fino a [`MAX_INSTANCE_PARTS`] collegamenti.
  links(model: DocumentModel): Unit[] {
    const units: Unit[] = [];
    const linked = new Map<ContainerNode, boolean>();
    let depth = 0;
    const visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null): void => {
      if (node.details === null || units.length >= MAX_INSTANCE_PARTS) return;
      if (node.details.role === "link") {
        push(units, this.unit(node, path, layer, parent, style, clips));
        return;
      }
      const symbol = node.details.role === "instance" ? this.symbolNode(node, node.details.symbol!) : null;
      if (node.kind !== "container" && (symbol === null || depth >= MAX_SYMBOL_DEPTH || !hasLink(symbol, linked))) return;
      const attrs = this.attrsOf(node);
      if (attrs === null || hidden(attrs)) return;
      const matrix = compose(parent, transformOf(attrs));
      const inner = styleOf(style, attrs);
      const below = this.clipsOf(node, attrs, matrix, inner, clips);
      const container = symbol ?? (node as ContainerNode);
      const at = symbol === null ? path : symbolPath(symbol);
      if (symbol !== null) depth++;
      childLoop(container, (child, index) => visit(child, [...at, index], layer, matrix, inner, below));
      if (symbol !== null) depth--;
    };
    this.walk(model, (layer) => !layer.hidden, [], visit);
    return units;
  }

  /// Gli oggetti di `model` che si vedono, anche quelli bloccati che
  /// l'indice non tocca: ciò su cui le guide intelligenti si allineano. Dei
  /// contenitori `open`, il gruppo isolato e quelli da cui si sposta un
  /// oggetto, i figli uno per uno al posto del tutto; delle istanze di
  /// `through`, da cui si modifica un simbolo, il suo contenuto.
  seen(model: DocumentModel, open: ReadonlySet<ContainerNode> = new Set(), through: readonly LeafNode[] = []): Unit[] {
    const units: Unit[] = [];
    const visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null): void => {
      const entered = node.kind === "leaf" && through.includes(node) ? this.symbolNode(node, node.details!.symbol!) : null;
      if (entered === null && (node.kind !== "container" || !open.has(node))) {
        push(units, this.unit(node, path, layer, parent, style, clips));
        return;
      }
      const attrs = this.attrsOf(node);
      if (attrs === null || hidden(attrs)) return;
      const matrix = compose(parent, transformOf(attrs));
      const inner = styleOf(style, attrs);
      const below = this.clipsOf(node, attrs, matrix, inner, clips);
      const container = entered ?? (node as ContainerNode);
      const at = entered === null ? path : symbolPath(entered);
      childLoop(container, (child, index) => {
        if (pickable(child)) visit(child, [...at, index], layer, matrix, inner, below);
      });
    };
    this.walk(model, (layer) => !layer.hidden, [], visit);
    return units;
  }

  /// Gli oggetti di `model` che una tavola porta con sé quando si sposta:
  /// quelli che non sono bloccati né stanno in un livello bloccato, anche
  /// nascosti o in un livello nascosto, che altrimenti si ritroverebbero
  /// altrove quando tornano a vedersi. Il riquadro di uno nascosto è quello
  /// che avrebbe se si vedesse.
  movable(model: DocumentModel): Unit[] {
    const units: Unit[] = [];
    this.walk(model, (layer) => !layer.locked, [], (node, path, layer, parent, style, clips) => {
      if (node.details!.locked !== true) push(units, this.unit(node, path, layer, parent, style, clips, true));
    });
    return units;
  }

  /// Il riquadro di tutto ciò che `model` disegna, contorno compreso: anche
  /// gli oggetti dei livelli bloccati o nascosti, che l'indice non tocca ma
  /// che restano nel disegno. `null` se non disegna niente.
  extent(model: DocumentModel): Bounds | null {
    const units: Unit[] = [];
    const parts: Part[] = [];
    this.walk(
      model,
      () => true,
      [],
      (node, path, layer, parent, style, clips) => push(units, this.unit(node, path, layer, parent, style, clips)),
      (leaf, parent, style, _path, clips) => this.estimate(leaf, parent, IDENTITY, style, fixed(clips), parts),
    );
    const out = new BoundsBuilder();
    for (const unit of units) {
      if (unit.bounds === null) continue;
      out.include(unit.bounds.min);
      out.include(unit.bounds.max);
    }
    for (const part of parts) {
      const bounds = this.sceneBounds(part);
      if (bounds !== null) includeSeen(out, part, bounds, part.radius * scaleOf(part.matrix), "scene");
    }
    return out.finish();
  }

  /// I blocchi estranei di `model` che si vedono fuori dagli oggetti, in
  /// ordine di documento: si vedono come uno strato immagine, ma non si
  /// scelgono.
  foreignBlocks(model: DocumentModel): ForeignBlock[] {
    const out: ForeignBlock[] = [];
    this.walk(model, (layer) => !layer.hidden, [], () => {}, (leaf, parent, style, path, clips) => {
      const parts: Part[] = [];
      this.estimate(leaf, parent, IDENTITY, style, fixed(clips), parts);
      if (parts.length > 0) out.push(new ForeignBlock(path, parts));
    });
    return out;
  }

  /// Il riquadro nella scena di `node`, un elemento di `model`, contorno
  /// compreso, come se né lui né chi lo contiene fosse nascosto: ciò che la
  /// sua miniatura inquadra, e la miniatura mostra ciò che ritagli e
  /// maschere lasciano vedere. Ciò che è nascosto dentro di lui non conta.
  /// `null` se non disegna niente, o se non è del disegno.
  frameOf(model: DocumentModel, node: ElementPart): Bounds | null {
    if (node.kind === "leaf" && node.details === null) return null;
    const chain: ContainerNode[] = [];
    for (let at = node.parent; at !== null && at !== model.root; at = at.parent) chain.unshift(at);
    let matrix = IDENTITY;
    let style = this.rootStyle(model);
    let clips: readonly Clip[] | null = null;
    for (const container of chain) {
      const attrs = this.builder.headInfo(container).attrs;
      matrix = compose(matrix, transformOf(attrs));
      style = styleOf(style, attrs);
      clips = this.clipsOf(container, attrs, matrix, style, clips);
    }
    const attrs = this.attrsOf(node);
    if (attrs === null) return null;
    const own = compose(matrix, transformOf(attrs));
    const inner = styleOf(style, attrs);
    const parts: Part[] = [];
    this.collect(node, own, IDENTITY, inner, this.regionsOf(node, attrs, own, inner, clips), parts);
    const scene = new BoundsBuilder();
    for (const part of parts) {
      const bounds = this.sceneBounds(part);
      if (bounds !== null) includeSeen(scene, part, bounds, part.radius * scaleOf(part.matrix), "scene");
    }
    return scene.finish();
  }

  /// I livelli di `model` in `layers`, e i suoi oggetti a `visit`: degli
  /// oggetti nei livelli, solo quelli dei livelli che `enters` accetta. I
  /// blocchi estranei degli stessi posti vanno a `foreign`, se c'è.
  private walk(
    model: DocumentModel,
    enters: (layer: LayerInfo) => boolean,
    layers: LayerInfo[],
    visit: Visit,
    foreign: ForeignVisit | null = null,
  ): void {
    const root = model.root;
    const rootStyle = this.rootStyle(model);
    const pages = this.pagesOf(model);
    childLoop(root, (child, index) => {
      if (pages !== null) {
        if (child.kind === "container" && pages.includes(child)) this.walkLayer(child, [index], "", false, false, rootStyle, enters, layers, visit, foreign);
        return;
      }
      if (child.kind === "leaf") {
        if (child.details === null) {
          foreign?.(child, IDENTITY, rootStyle, [index], null);
          return;
        }
        const role = child.details.role;
        if (role === "paper" || role === "board" || role === "title" || role === "desc") return;
        visit(child, [index], null, IDENTITY, rootStyle, null);
        return;
      }
      const role = child.details!.role;
      // Le risorse si vedono soltanto in chi le usa.
      if (role === "defs") return;
      if (role !== "layer") {
        visit(child, [index], null, IDENTITY, rootStyle, null);
        return;
      }
      const layer = child.details!.layer!;
      this.walkLayer(child, [index], layer.name, layer.locked, layer.hidden, rootStyle, enters, layers, visit, foreign);
    });
  }

  /// Un livello, o un gruppo di una pagina che ne fa le veci: in `layers`, e
  /// i suoi figli a `visit` se `enters` lo accetta, col ritaglio e la
  /// maschera del livello.
  private walkLayer(
    child: ContainerNode,
    path: number[],
    name: string,
    locked: boolean,
    hidden: boolean,
    rootStyle: Style,
    enters: (layer: LayerInfo) => boolean,
    layers: LayerInfo[],
    visit: Visit,
    foreign: ForeignVisit | null,
  ): void {
    const head = this.builder.headInfo(child);
    const matrix = compose(IDENTITY, transformOf(head.attrs));
    const info: LayerInfo = { id: child.facts.id, path, name, locked, hidden: hidden || head.hidden, matrix };
    layers.push(info);
    if (!enters(info)) return;
    const style = styleOf(rootStyle, head.attrs);
    const clips = this.clipsOf(child, head.attrs, matrix, style, null);
    childLoop(child, (grandchild, inner) => {
      if (grandchild.kind === "leaf") {
        if (grandchild.details === null) {
          foreign?.(grandchild, matrix, style, [...path, inner], clips);
          return;
        }
        if (grandchild.details.role === "title" || grandchild.details.role === "desc") return;
      }
      visit(grandchild, [...path, inner], info.id, matrix, style, clips);
    });
  }

  /// I gruppi della pagina che si annota; `null` per un disegno.
  private pagesOf(model: DocumentModel): readonly ContainerNode[] | null {
    return this.pages === null ? null : this.pages(model);
  }

  /// Lo stile che la radice di `model` trasmette ai figli.
  private rootStyle(model: DocumentModel): Style {
    return styleOf(INITIAL, this.builder.headInfo(model.root).attrs);
  }

  /// L'oggetto `node`, se si vede, o anche nascosto con `shown`. `clips` sono
  /// i ritagli e le maschere di chi lo contiene.
  private unit(node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null, shown = false): Unit | null {
    const attrs = this.attrsOf(node);
    if (attrs === null || (!shown && hidden(attrs))) return null;
    const own = transformOf(attrs);
    const matrix = compose(parent, own);
    const inner = styleOf(style, attrs);
    const parts: Part[] = [];
    this.collect(node, matrix, IDENTITY, inner, this.regionsOf(node, attrs, matrix, inner, clips), parts);
    const scene = new BoundsBuilder();
    const geometry = new BoundsBuilder();
    for (const part of parts) {
      const bounds = this.sceneBounds(part);
      if (bounds === null) continue;
      includeSeen(scene, part, bounds, part.radius * scaleOf(part.matrix), "scene");
      if (part.host === null) includeSeen(geometry, part, bounds, 0, "scene");
    }
    const id = node.facts.id;
    const tag = tagName(node);
    const look = node.kind === "leaf" && node.details!.role === "text" ? textLook(this.builder.shape(node), inner, node.details!.wrap ?? null, this.textTrack(node)) : null;
    return new Unit(
      id ?? `@${path.join(".")}`,
      id ?? { path, tag },
      id,
      path,
      tag,
      node.details!.role,
      layer,
      parent,
      own,
      this.builder.paintsOf(node),
      scene.finish(),
      geometry.finish(),
      parts,
      node,
      inner,
      look,
    );
  }

  /// Gli attributi dipinti di un elemento; `null` se non disegna.
  private attrsOf(node: ElementPart): readonly PaintAttr[] | null {
    if (node.kind === "container") return this.builder.headInfo(node).attrs;
    const shape = this.builder.shape(node);
    return shape === null ? null : shape.attrs;
  }

  /// Le forme di `node` e dei suoi discendenti visibili. `matrix` porta le
  /// coordinate di `node` nella scena, `frame` in quelle dell'oggetto;
  /// `regions` sono i ritagli e le maschere che lo tagliano, i suoi compresi.
  ///
  /// Le forme del contenuto di un simbolo, attraverso un'istanza, hanno in
  /// `via` la più esterna.
  private collect(node: ElementPart, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via | null = null): void {
    if (node.kind === "leaf") {
      if (node.details!.role === "instance") {
        this.instance(node, matrix, frame, style, regions, out, via ?? { leaf: node, matrix });
        return;
      }
      if (node.details!.role === "copy") {
        this.copy(node, matrix, frame, style, regions, out, via ?? { leaf: node, matrix });
        return;
      }
      const shape = this.builder.shape(node)!;
      const part = this.part(node, shape, matrix, frame, style, regions, via);
      out.push(part);
      if (MARKED.has(shape.tag)) this.tips(part, shape.attrs, style, out);
      return;
    }
    this.children(node, matrix, frame, style, regions, out, via);
  }

  /// Le forme dei figli visibili di `container`, come [`collect`].
  private children(container: ContainerNode, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via | null): void {
    childLoop(container, (child) => {
      if (child.kind === "leaf" && child.details === null) {
        this.estimate(child, matrix, frame, style, regions, out, via);
        return;
      }
      const childAttrs = this.attrsOf(child);
      if (childAttrs === null || hidden(childAttrs)) return;
      const own = transformOf(childAttrs);
      const childMatrix = compose(matrix, own);
      const childFrame = compose(frame, own);
      const inner = styleOf(style, childAttrs);
      this.collect(child, childMatrix, childFrame, inner, this.regionsBelow(child, childAttrs, childMatrix, childFrame, inner, regions), out, via);
    });
  }

  /// Le forme di un'istanza: il contenuto del suo simbolo nelle sue
  /// coordinate, `matrix` e `frame`, con lo stile che lei trasmette. Oltre
  /// [`MAX_INSTANCE_PARTS`] forme nell'oggetto, il riquadro del simbolo.
  private instance(leaf: LeafNode, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via): void {
    const symbol = this.symbolNode(leaf, leaf.details!.symbol!);
    if (symbol === null || this.depth >= MAX_SYMBOL_DEPTH) return;
    const info = this.symbolInfo(symbol, style);
    if (out.length + info.parts > MAX_INSTANCE_PARTS) {
      const box = info.box;
      if (box === null) return;
      const segments = rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0);
      out.push({ leaf, segments, matrix, frameMatrix: frame, fill: true, radius: 0, cache: null, flat: null, host: null, regions, via });
      return;
    }
    this.depth++;
    try {
      this.children(symbol, matrix, frame, style, regions, out, via);
    } finally {
      this.depth--;
    }
  }

  /// Le forme di una copia: il suo originale nelle sue coordinate, `matrix`
  /// e `frame`, con la sua trasformazione, il suo stile e i suoi ritagli,
  /// come lo disegna un `use`. Oltre [`MAX_INSTANCE_PARTS`] forme
  /// nell'oggetto, il riquadro dell'originale.
  private copy(leaf: LeafNode, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via): void {
    const original = originalOf(leaf);
    const attrs = original === null ? null : this.attrsOf(original);
    if (attrs === null || hidden(attrs)) return;
    const own = transformOf(attrs);
    const inner = styleOf(style, attrs);
    const at = compose(matrix, own);
    const atFrame = compose(frame, own);
    const below = this.regionsBelow(original!, attrs, at, atFrame, inner, regions);
    if (out.length < MAX_INSTANCE_PARTS) {
      this.collect(original!, at, atFrame, inner, below, out, via);
      return;
    }
    const box = this.originalBox(original!, inner);
    if (box === null) return;
    const segments = rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0);
    out.push({ leaf, segments, matrix: at, frameMatrix: atFrame, fill: true, radius: 0, cache: null, flat: null, host: null, regions: below, via });
  }

  /// Il riquadro della geometria dell'originale `node`, misurato una volta
  /// per ciò che il painter ne disegna. Lo stile è quello della prima copia
  /// che lo chiede: conta soltanto per i testi.
  private originalBox(node: ElementPart, style: Style): Bounds | null {
    const [paint] = this.builder.paintsOf(node);
    const known = paint === undefined ? undefined : this.originalBoxes.get(paint);
    if (known !== undefined) return known;
    const box = this.objectBox(node, style);
    if (paint !== undefined) this.originalBoxes.set(paint, box);
    return box;
  }

  /// Quante forme dà il contenuto di `symbol`, a cascata, e il riquadro
  /// della sua geometria, senza contorni né marcatori: si misurano una volta
  /// per contenuto. Lo stile è quello della prima istanza che lo chiede:
  /// conta soltanto per i testi.
  private symbolInfo(symbol: ContainerNode, style: Style): SymbolInfo {
    const [paint] = this.builder.paintsOf(symbol);
    const outer = this.reached;
    const known = paint === undefined ? undefined : this.symbolInfos.get(paint);
    if (known !== undefined && (known.scene === null || known.scene === this.builder.built) && [...known.uses].every(([node, group]) => this.builder.paintsOf(node)[0] === group)) {
      if (outer !== null) for (const [node, group] of known.uses) outer.set(node, group);
      outer?.set(symbol, paint);
      return known;
    }
    const parts: Part[] = [];
    const uses = new Map<ContainerNode, PaintNode | undefined>();
    this.reached = uses;
    this.depth++;
    try {
      this.children(symbol, IDENTITY, IDENTITY, style, null, parts, null);
    } finally {
      this.depth--;
      this.reached = outer;
    }
    const box = new BoundsBuilder();
    for (const part of parts) {
      if (part.host !== null) continue;
      const bounds = transformedBounds(part.segments, part.matrix);
      if (bounds !== null) includeInflated(box, bounds, 0);
    }
    const info: SymbolInfo = { parts: parts.length, box: box.finish(), uses, scene: this.builder.drawsLive(symbol) ? null : this.builder.built };
    if (paint !== undefined) this.symbolInfos.set(paint, info);
    if (outer !== null) for (const [node, group] of uses) outer.set(node, group);
    outer?.set(symbol, paint);
    return info;
  }

  /// I ritagli e le maschere di `node`, un elemento con gli attributi dipinti
  /// `attrs`, dopo quelli di chi lo contiene, `outer`. `matrix` porta le
  /// coordinate di `node` nella scena e `style` è lo stile che trasmette ai
  /// figli, che serve a misurare il riquadro della sua geometria. Senza
  /// ritagli né maschere, `outer` com'è.
  private clipsOf(node: ElementPart, attrs: readonly PaintAttr[], matrix: Matrix, style: Style, outer: readonly Clip[] | null): readonly Clip[] | null {
    let clipId: string | null = null;
    let maskId: string | null = null;
    for (const [name, value] of attrs) {
      if (name === "clip-path") clipId = reference(value);
      else if (name === "mask") maskId = reference(value);
    }
    if (clipId === null && maskId === null) return outer;
    const found: Clip[] = [];
    let box: Bounds | null | undefined;
    for (const [id, tag] of [[clipId, "clipPath"], [maskId, "mask"]] as const) {
      const look = id === null ? null : this.clipLook(node, id, tag);
      if (look === null) continue;
      if (needsBox(look) && box === undefined) box = this.objectBox(node, style);
      found.push(new Clip(look, matrix, box ?? null));
    }
    if (found.length === 0) return outer;
    return outer === null ? found : [...outer, ...found];
  }

  /// Le regioni di un oggetto `node`, la cui matrice nella scena è `matrix`:
  /// i ritagli e le maschere di chi lo contiene, `outer`, che restano dove
  /// sono quando l'oggetto si sposta, e i suoi, che vanno con lui.
  private regionsOf(node: ElementPart, attrs: readonly PaintAttr[], matrix: Matrix, style: Style, outer: readonly Clip[] | null): readonly Region[] | null {
    const clips = this.clipsOf(node, attrs, matrix, style, outer);
    if (clips === null) return null;
    const back = outer === null ? null : invert(matrix);
    const fixed = outer === null ? 0 : outer.length;
    return clips.map((clip, at) => (at < fixed ? new Region(clip, back === null ? null : compose(back, clip.user), false) : new Region(clip, IDENTITY, true)));
  }

  /// Le regioni di una forma sotto `node`, un discendente dell'oggetto con
  /// `frame` dalle sue coordinate a quelle dell'oggetto: quelle di prima,
  /// `outer`, e le sue, che vanno con l'oggetto.
  private regionsBelow(
    node: ElementPart,
    attrs: readonly PaintAttr[],
    matrix: Matrix,
    frame: Matrix,
    style: Style,
    outer: readonly Region[] | null,
  ): readonly Region[] | null {
    const clips = this.clipsOf(node, attrs, matrix, style, null);
    if (clips === null) return outer;
    const added = clips.map((clip) => new Region(clip, frame, true));
    return outer === null ? added : [...outer, ...added];
  }

  /// Il riquadro della geometria di `node` nelle sue coordinate, senza
  /// contorno, punte, ritagli né maschere: `objectBoundingBox`. `style` è
  /// quello che trasmette ai figli. `null` se non disegna niente.
  private objectBox(node: ElementPart, style: Style): Bounds | null {
    const out = new BoundsBuilder();
    this.addGeometry(node, IDENTITY, style, out);
    return out.finish();
  }

  private addGeometry(node: ElementPart, matrix: Matrix, style: Style, out: BoundsBuilder): void {
    if (node.kind === "leaf") {
      if (node.details!.role === "instance") {
        // Il riquadro del simbolo, che si misura una volta.
        const symbol = this.symbolNode(node, node.details!.symbol!);
        const box = symbol === null || this.depth >= MAX_SYMBOL_DEPTH ? null : this.symbolInfo(symbol, style).box;
        if (box !== null) out.path(rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0), matrix);
        return;
      }
      if (node.details!.role === "copy") {
        const original = originalOf(node);
        const attrs = original === null ? null : this.attrsOf(original);
        if (attrs !== null && !hidden(attrs)) this.addGeometry(original!, compose(matrix, transformOf(attrs)), styleOf(style, attrs), out);
        return;
      }
      out.path(this.part(node, this.builder.shape(node)!, matrix, matrix, style, null).segments, matrix);
      return;
    }
    childLoop(node, (child) => {
      if (child.kind === "leaf" && child.details === null) {
        for (const shape of this.foreign.shapes(child, style)) out.path(shape.segments, compose(matrix, shape.matrix));
        return;
      }
      const attrs = this.attrsOf(child);
      if (attrs === null || hidden(attrs)) return;
      this.addGeometry(child, compose(matrix, transformOf(attrs)), styleOf(style, attrs), out);
    });
  }

  /// Il ritaglio o la maschera, secondo `tag`, di id `id` nel documento di
  /// `from`, letti e ricordati per risorsa; `null` se non c'è, se è un'altra
  /// risorsa o se non disegna niente.
  private clipLook(from: ElementPart, id: string, tag: "clipPath" | "mask"): ClipLook | null {
    const resource = this.liveResource(from, id);
    if (resource === null || resource.tag !== tag) return null;
    let look = this.looks.get(resource);
    if (look === undefined) {
      look = clipLook(resource);
      this.looks.set(resource, look);
    }
    return look;
  }

  private part(leaf: LeafNode, shape: PaintShape, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, via: Via | null = null): Part {
    let cache = this.cache.get(shape) ?? null;
    let segments: readonly Segment[];
    if (shape.tag === "text") {
      // Il riquadro di un testo dipende dallo stile ereditato, e dal suo
      // tracciato: non si ricorda.
      segments = textSegments(shape.attrs, shape.runs ?? [], style, leaf.details!.wrap ?? null, this.textTrack(leaf));
      cache = null;
    } else {
      if (cache === null) {
        cache = { segments: null, scene: null, local: undefined };
        this.cache.set(shape, cache);
      }
      cache.segments ??= shapeSegments(shape.tag, shape.attrs);
      segments = cache.segments;
    }
    const tag = leaf.details!.tag;
    // Una linea non ha area; un testo e un'immagine si toccano nel loro
    // riquadro.
    const fill = tag === "line" ? false : tag === "text" || tag === "image" ? true : style.fill;
    const radius = style.stroke && tag !== "text" && tag !== "image" ? style.strokeWidth / 2 : 0;
    return { leaf, segments, matrix, frameMatrix: frame, fill, radius, cache, flat: null, host: null, regions, via };
  }

  /// I marcatori di `host`, una forma con gli attributi `attrs` e lo stile
  /// `style`, che si disegnano sopra di lei: le punte delle linee. Un
  /// marcatore che non c'è o che non disegna niente non conta.
  private tips(host: Part, attrs: readonly PaintAttr[], style: Style, out: Part[]): void {
    let list: readonly Vertex[] | null = null;
    for (const [place, name] of MARKER_PROPERTIES) {
      const value = attr(attrs, name);
      const id = value === undefined ? null : reference(value);
      const look = id === null ? null : this.marker(host.leaf, id);
      if (look === null) continue;
      list ??= host.cache === null ? vertices(host.segments) : (host.cache.vertices ??= vertices(host.segments));
      for (const vertex of placed(list, place)) {
        const m = markerMatrix(look.fit, vertex, place, style.strokeWidth);
        for (const shape of look.shapes) {
          const local = compose(m, shape.matrix);
          out.push({
            leaf: host.leaf,
            segments: shape.segments,
            matrix: compose(host.matrix, local),
            frameMatrix: compose(host.frameMatrix, local),
            fill: shape.fill,
            radius: shape.radius,
            cache: null,
            flat: null,
            host,
            regions: host.regions,
            via: host.via,
          });
        }
      }
    }
  }

  /// La risorsa viva di id `id` nel documento di `from`; `null` se non c'è.
  private liveResource(from: ElementPart, id: string): PaintResource | null {
    const node = this.holder === null ? this.resourceNode(from, id) : this.holder(id);
    if (node === null || node.kind !== "leaf" || node.details?.role !== "resource") return null;
    return this.builder.resource(node);
  }

  /// Il marcatore vivo di id `id` nel documento di `leaf`, letto e ricordato
  /// per risorsa; `null` se non c'è o non disegna niente.
  private marker(leaf: LeafNode, id: string): MarkerLook | null {
    const resource = this.liveResource(leaf, id);
    if (resource === null || resource.tag !== "marker") return null;
    let look = this.markers.get(resource);
    if (look === undefined) {
      look = markerLook(resource);
      this.markers.set(resource, look);
    }
    return look;
  }

  /// Il tracciato misurato del testo su tracciato `leaf`: una risorsa del
  /// suo documento. `null` per un testo che non ne segue uno.
  private textTrack(leaf: LeafNode): Track | null {
    const id = leaf.details?.textPath;
    if (id === undefined) return null;
    const child = this.resourceNode(leaf, id);
    if (child === null) return null;
    const resource = this.builder.resource(child);
    let track = this.tracks.get(resource);
    if (track === undefined) {
      const d = resource.attrs.find(([name]) => name === "d")?.[1];
      const segments = d === undefined ? null : parsePath(d);
      track = segments === null ? null : new Track(segments);
      this.tracks.set(resource, track);
    }
    return track;
  }

  /// La risorsa di id `id` nelle `defs` della radice del documento di
  /// `from`; `null` se non c'è.
  private resourceNode(from: ElementPart, id: string): LeafNode | null {
    const found = defsChild(from, id, (child) => child.kind === "leaf" && child.details?.role === "resource");
    return found === null ? null : (found as LeafNode);
  }

  /// Il simbolo di id `id` del documento di `from`; `null` se non c'è.
  private symbolNode(from: ElementPart, id: string): ContainerNode | null {
    const isSymbol = (node: ElementPart): boolean => node.kind === "container" && node.details?.role === "symbol";
    const node = this.holder === null ? defsChild(from, id, isSymbol) : this.holder(id);
    return node !== null && isSymbol(node) ? (node as ContainerNode) : null;
  }

  /// Le forme stimate del blocco estraneo `leaf`, figlio di un contenitore
  /// che `matrix` porta nella scena e `frame` nelle coordinate dell'oggetto,
  /// tagliate dalle regioni del contenitore. Il ritaglio e la maschera che il
  /// blocco scrive per sé non si leggono: è una stima.
  private estimate(leaf: LeafNode, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via | null = null): void {
    for (const shape of this.foreign.shapes(leaf, style)) {
      out.push({
        leaf,
        segments: shape.segments,
        matrix: compose(matrix, shape.matrix),
        frameMatrix: compose(frame, shape.matrix),
        fill: shape.fill,
        radius: shape.radius,
        cache: shape.cache,
        flat: null,
        host: null,
        regions,
        via,
      });
    }
  }

  /// Il riquadro geometrico di una forma nella scena, ricordato per matrice.
  private sceneBounds(part: Part): Bounds | null {
    const cache = part.cache;
    if (cache !== null && cache.scene !== null && sameMatrix(cache.scene.matrix, part.matrix)) return cache.scene.bounds;
    const bounds = transformedBounds(part.segments, part.matrix);
    if (cache !== null) cache.scene = { matrix: part.matrix, bounds };
    return bounds;
  }
}

/// Dove stanno i figli di un contenitore: il suo percorso, il livello, la
/// matrice dalle sue coordinate a quelle della scena, lo stile che trasmette
/// e i ritagli e le maschere suoi e di chi lo contiene.
interface Context {
  readonly path: readonly number[];
  readonly layer: string | null;
  readonly matrix: Matrix;
  readonly style: Style;
  readonly clips: readonly Clip[] | null;
}

type MakeUnit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null) => Unit | null;

/// Aggiunge a `outer` i ritagli e le maschere di un contenitore: il nodo, i
/// suoi attributi dipinti, la matrice dalle sue coordinate a quelle della
/// scena e lo stile che trasmette.
type AddClips = (node: ElementPart, attrs: readonly PaintAttr[], matrix: Matrix, style: Style, outer: readonly Clip[] | null) => readonly Clip[] | null;

/// Trova gli oggetti dentro i gruppi di un documento, per un indice: con
/// `scope` solo quelli dentro il gruppo isolato.
class Lookup implements Nested {
  private ids: Map<string, ElementPart> | null = null;
  private readonly contexts = new Map<ContainerNode, Context | null>();

  constructor(
    private readonly model: DocumentModel,
    readonly scope: ContainerNode | null,
    /// Le istanze da cui si entra nei simboli, dalla più esterna.
    private readonly through: readonly LeafNode[],
    private readonly rootStyle: Style,
    private readonly attrsOf: (node: ElementPart) => readonly PaintAttr[] | null,
    private readonly make: MakeUnit,
    private readonly addClips: AddClips,
    /// Le pagine che si annotano: gli altri figli della radice non ci sono.
    private readonly pages: readonly ContainerNode[] | null = null,
  ) {}

  resolve(key: string): Unit | null {
    const node = key.startsWith("@") ? this.byPath(key.slice(1)) : this.byId(key);
    if (node === null || !pickable(node) || node.details!.locked === true) return null;
    const parent = node.parent;
    if (parent === null || (this.scope !== null && !within(node, this.scope))) return null;
    // Sulle pagine di un PDF un figlio della radice non è un oggetto.
    if (this.pages !== null && parent === this.model.root) return null;
    const context = this.contextOf(parent);
    if (context === null) return null;
    const index = elementChildren(parent).indexOf(node);
    if (index < 0) return null;
    const unit = this.make(node, [...context.path, index], context.layer, context.matrix, context.style, context.clips);
    return unit !== null && unit.key === key ? unit : null;
  }

  childrenOf(container: ContainerNode): Unit[] {
    const role = container.details?.role;
    if (role !== "group" && role !== "link" && role !== "symbol") return [];
    if (this.scope !== null && container !== this.scope && !within(container, this.scope)) return [];
    const context = this.contextOf(container);
    if (context === null) return [];
    const out: Unit[] = [];
    childLoop(container, (child, index) => {
      if (pickable(child) && child.details!.locked !== true) push(out, this.make(child, [...context.path, index], context.layer, context.matrix, context.style, context.clips));
    });
    return out;
  }

  copiesOf(container: ContainerNode): Unit[] {
    if (container.details?.repeat === undefined) return [];
    if (this.scope !== null && container !== this.scope && !within(container, this.scope)) return [];
    const context = this.contextOf(container);
    if (context === null) return [];
    const out: Unit[] = [];
    childLoop(container, (child, index) => {
      if (child.details?.role === "copy" && child.details.locked !== true) push(out, this.make(child, [...context.path, index], context.layer, context.matrix, context.style, context.clips));
    });
    return out;
  }

  scopeUnit(): Unit | null {
    const scope = this.scope;
    const parent = scope?.parent ?? null;
    if (scope === null || parent === null) return null;
    if (scope.details?.role === "symbol") {
      // Il simbolo ha le coordinate, lo stile e i ritagli che l'istanza dà
      // al suo contenuto, e nessuna trasformazione sua.
      const context = this.contextOf(scope);
      return context === null ? null : this.make(scope, [...context.path], context.layer, context.matrix, context.style, context.clips);
    }
    const context = this.contextOf(parent);
    const index = elementChildren(parent).indexOf(scope);
    if (context === null || index < 0 || this.contextOf(scope) === null) return null;
    return this.make(scope, [...context.path, index], context.layer, context.matrix, context.style, context.clips);
  }

  /// Dove stanno i figli di `container`; `null` se lì non si sceglie: se il
  /// contenitore non sta nel documento, o se lui o uno che lo contiene è
  /// bloccato o nascosto.
  contextOf(container: ContainerNode): Context | null {
    let context = this.contexts.get(container);
    if (context === undefined) {
      context = this.compute(container);
      this.contexts.set(container, context);
    }
    return context;
  }

  private compute(container: ContainerNode): Context | null {
    if (container === this.model.root) return { path: [], layer: null, matrix: IDENTITY, style: this.rootStyle, clips: null };
    const parent = container.parent;
    const details = container.details;
    if (parent === null || details === null || details.locked === true) return null;
    if (details.role === "symbol") return this.symbolContext(container);
    // Sulle pagine di un PDF i gruppi della pagina fanno da livelli, e gli
    // altri figli della radice non ci sono.
    const page = this.pages !== null && parent === this.model.root;
    if (page && !this.pages!.includes(container)) return null;
    const isLayer = page || details.role === "layer";
    if (isLayer ? parent !== this.model.root : details.role !== "group" && details.role !== "link") return null;
    const index = elementChildren(parent).indexOf(container);
    const outer = index < 0 ? null : this.contextOf(parent);
    const attrs = this.attrsOf(container);
    if (outer === null || attrs === null || hidden(attrs)) return null;
    const matrix = compose(outer.matrix, transformOf(attrs));
    const style = styleOf(outer.style, attrs);
    return {
      path: [...outer.path, index],
      layer: isLayer ? container.facts.id : outer.layer,
      matrix,
      style,
      clips: this.addClips(container, attrs, matrix, style, outer.clips),
    };
  }

  /// Dove sta il contenuto di `symbol`: dove lo mette la sua istanza fra
  /// quelle da cui si entra, che si sceglie dove sta. `null` senza.
  private symbolContext(symbol: ContainerNode): Context | null {
    const instance = this.through.find((each) => each.details?.role === "instance" && each.details.symbol === symbol.facts.id);
    const parent = instance?.parent ?? null;
    if (instance === undefined || parent === null || instance.details!.locked === true || elementChildren(parent).indexOf(instance) < 0) return null;
    if (this.pages !== null && parent === this.model.root) return null;
    const outer = this.contextOf(parent);
    const attrs = this.attrsOf(instance);
    if (outer === null || attrs === null || hidden(attrs)) return null;
    const matrix = compose(outer.matrix, transformOf(attrs));
    const style = styleOf(outer.style, attrs);
    return { path: symbolPath(symbol), layer: outer.layer, matrix, style, clips: this.addClips(instance, attrs, matrix, style, outer.clips) };
  }

  private byPath(text: string): ElementPart | null {
    if (!/^\d+(\.\d+)*$/.test(text)) return null;
    let node: ElementPart = this.model.root;
    for (const step of text.split(".")) {
      if (node.kind !== "container") return null;
      const child: ElementPart | undefined = elementChildren(node)[Number(step)];
      if (child === undefined) return null;
      node = child;
    }
    return node;
  }

  private byId(id: string): ElementPart | null {
    if (this.ids === null) {
      const ids = new Map<string, ElementPart>();
      const visit = (container: ContainerNode): void => childLoop(container, (child) => {
        if (child.facts.id !== null && !ids.has(child.facts.id)) ids.set(child.facts.id, child);
        if (child.kind === "container") visit(child);
      });
      visit(this.model.root);
      this.ids = ids;
    }
    return this.ids.get(id) ?? null;
  }
}

/// Vero se `node` è un oggetto, nel posto dove sta: non la carta, il titolo,
/// la descrizione, un livello, le risorse con la loro `defs`, una copia in
/// una ripetizione o un blocco estraneo.
function pickable(node: ElementPart): boolean {
  const role = node.details?.role;
  return role !== undefined && !NOT_PICKABLE.has(role);
}

const NOT_PICKABLE: ReadonlySet<string> = new Set(["paper", "board", "title", "desc", "layer", "defs", "resource", "copy"]);

/// Vero se il percorso `a` viene dopo `b` nel documento: sta più in alto.
function later(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return a.length > b.length;
}

/// Il percorso di `symbol` nel documento: la sua `defs` fra i figli della
/// radice, e lui fra quelli della `defs`.
function symbolPath(symbol: ContainerNode): number[] {
  const defs = symbol.parent!;
  return [elementChildren(defs.parent!).indexOf(defs), elementChildren(defs).indexOf(symbol)];
}

/// Vero se nel contenuto di `symbol`, anche attraverso le istanze di altri
/// simboli, c'è un collegamento; `known` ricorda i simboli già visti.
function hasLink(symbol: ContainerNode, known: Map<ContainerNode, boolean>): boolean {
  const seen = known.get(symbol);
  if (seen !== undefined) return seen;
  // Un ciclo non c'è, ma un documento rotto non deve girare per sempre.
  known.set(symbol, false);
  let found = false;
  const visit = (container: ContainerNode): void => childLoop(container, (child) => {
    if (found || child.details === null) return;
    if (child.details.role === "link") found = true;
    else if (child.kind === "container") visit(child);
    else if (child.details.role === "instance") {
      const target = defsChild(child, child.details.symbol!, (node) => node.kind === "container" && node.details?.role === "symbol");
      if (target !== null && hasLink(target as ContainerNode, known)) found = true;
    }
  });
  visit(symbol);
  known.set(symbol, found);
  return found;
}

/// Il figlio di una `defs` della radice del documento di `from` con l'id
/// `id` che `fits` accetta; `null` se non c'è.
function defsChild(from: ElementPart, id: string, fits: (node: ElementPart) => boolean): ElementPart | null {
  let root = from.parent;
  while (root !== null && root.parent !== null) root = root.parent;
  if (root === null) return null;
  for (const defs of elementChildren(root)) {
    if (defs.kind !== "container" || defs.details?.role !== "defs") continue;
    for (const child of elementChildren(defs)) if (child.facts.id === id && fits(child)) return child;
  }
  return null;
}

/// Vero se `node` sta dentro `container`, a qualunque profondità.
function within(node: ElementPart, container: ContainerNode): boolean {
  for (let current = node.parent; current !== null; current = current.parent) if (current === container) return true;
  return false;
}

function push(out: Unit[], unit: Unit | null): void {
  if (unit !== null) out.push(unit);
}

// ---------------------------------------------------------------------------
// Lettura degli attributi dipinti.
// ---------------------------------------------------------------------------

function childLoop(container: ContainerNode, visit: (child: ElementPart, index: number) => void): void {
  let index = 0;
  for (const part of container.parts) {
    if (typeof part === "string" || part.kind === "other") continue;
    visit(part, index++);
  }
}

function attr(attrs: readonly PaintAttr[], name: string): string | undefined {
  for (const [key, value] of attrs) if (key === name) return value;
  return undefined;
}

function hidden(attrs: readonly PaintAttr[]): boolean {
  return attr(attrs, "display")?.trim() === "none";
}

function transformOf(attrs: readonly PaintAttr[]): Matrix {
  const value = attr(attrs, "transform");
  return value === undefined ? IDENTITY : parseTransform(value) ?? IDENTITY;
}

function styleOf(parent: Style, attrs: readonly PaintAttr[]): Style {
  const fill = attr(attrs, "fill");
  const stroke = attr(attrs, "stroke");
  const width = attr(attrs, "stroke-width");
  const size = attr(attrs, "font-size");
  const anchor = attr(attrs, "text-anchor");
  const family = attr(attrs, "font-family");
  const weight = attr(attrs, "font-weight");
  const spacing = attr(attrs, "letter-spacing");
  if (fill === undefined && stroke === undefined && width === undefined && size === undefined && anchor === undefined && family === undefined && weight === undefined && spacing === undefined) {
    return parent;
  }
  return {
    fill: fill === undefined ? parent.fill : fill.trim() !== "none",
    stroke: stroke === undefined ? parent.stroke : stroke.trim() !== "none",
    strokeWidth: width === undefined ? parent.strokeWidth : Math.max(0, length(width) ?? parent.strokeWidth),
    fontSize: size === undefined ? parent.fontSize : nonNegativeLength(size) ?? parent.fontSize,
    spacing: spacing === undefined ? parent.spacing : letterSpacing(spacing) ?? parent.spacing,
    anchor: anchor === undefined ? parent.anchor : anchor.trim(),
    family: family === undefined ? parent.family : family.trim(),
    weight: weight === undefined ? parent.weight : weight.trim(),
    color: fill === undefined ? parent.color : fill.trim(),
  };
}

function len(attrs: readonly PaintAttr[], name: string): number | null {
  const value = attr(attrs, name);
  return value === undefined ? null : length(value);
}

/// I raggi di un'ellisse o degli angoli di un rettangolo: in SVG 2 un raggio
/// assente vale l'altro.
function radii(attrs: readonly PaintAttr[]): Point {
  const rx = len(attrs, "rx");
  const ry = len(attrs, "ry");
  return [rx ?? ry ?? 0, ry ?? rx ?? 0];
}

/// Un'ellisse come quattro archi, che il riquadro e l'appiattimento sanno
/// trattare esattamente.
function ellipsePath(cx: number, cy: number, rx: number, ry: number): Segment[] {
  if (!(rx > 0) || !(ry > 0)) return [];
  const arc = (to: Point): Segment => ({ kind: "arc", radii: [rx, ry], rotation: 0, large: false, sweep: true, to });
  return [
    { kind: "move", to: [cx + rx, cy] },
    arc([cx, cy + ry]),
    arc([cx - rx, cy]),
    arc([cx, cy - ry]),
    arc([cx + rx, cy]),
    { kind: "close" },
  ];
}

/// I segmenti di una forma nelle sue coordinate: il tracciato con cui SVG 2
/// la definisce, dallo stesso punto e nello stesso verso.
export function shapeSegments(tag: string, attrs: readonly PaintAttr[]): readonly Segment[] {
  const at = (name: string): number => len(attrs, name) ?? 0;
  switch (tag) {
    case "path": {
      const d = attr(attrs, "d");
      return d === undefined ? [] : parsePath(d) ?? [];
    }
    case "rect": {
      const [w, h] = [at("width"), at("height")];
      // SVG non disegna un rettangolo con un lato nullo.
      if (!(w > 0) || !(h > 0)) return [];
      const [rx, ry] = radii(attrs);
      return rectPath(at("x"), at("y"), w, h, rx, ry);
    }
    case "image": {
      const [w, h] = [at("width"), at("height")];
      if (!(w > 0) || !(h > 0)) return [];
      return rectPath(at("x"), at("y"), w, h, 0, 0);
    }
    case "ellipse": {
      const [rx, ry] = radii(attrs);
      return ellipsePath(at("cx"), at("cy"), rx, ry);
    }
    case "circle":
      return ellipsePath(at("cx"), at("cy"), at("r"), at("r"));
    case "line":
      return [{ kind: "move", to: [at("x1"), at("y1")] }, { kind: "line", to: [at("x2"), at("y2")] }];
    case "polyline":
    case "polygon": {
      const value = attr(attrs, "points");
      const list = value === undefined ? null : parsePoints(value);
      if (list === null || list.length === 0) return [];
      const segments: Segment[] = list.map((p, i) => ({ kind: i === 0 ? "move" : "line", to: p }) as Segment);
      if (tag === "polygon") segments.push({ kind: "close" });
      return segments;
    }
    default:
      return [];
  }
}

/// Quanto è largo un carattere, e dove stanno sopra e sotto la linea di base
/// i bordi di una riga, in volte il corpo: una stima, la misura vera dipende
/// dai caratteri.
const CHAR_EM = 0.6;
const ASCENT_EM = 0.8;
const DESCENT_EM = 0.25;

/// Dove comincia una riga larga `width` col punto d'ancoraggio in `x`.
function lineStart(x: number, width: number, anchor: string): number {
  return anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
}

/// Quanti caratteri si leggono in `text`: gli spazi in fila contano uno, ai
/// bordi niente, come li mostra SVG.
function readable(text: string): number {
  return [...text.replace(/\s+/g, " ").trim()].length;
}

/// La spaziatura delle lettere che scrive `attrs`, o quella che eredita.
function spacingOf(attrs: readonly PaintAttr[], inherited: number): number {
  const value = attr(attrs, "letter-spacing");
  return value === undefined ? inherited : letterSpacing(value) ?? inherited;
}

/// Quanto è larga e alta una riga di `chars` caratteri da leggere, a stima:
/// 0,6 em per carattere più la spaziatura delle lettere, col corpo e la
/// spaziatura di ogni pezzo per la sua parte di riga; l'altezza è quella del
/// corpo più grande.
function lineMeasure(parts: readonly (string | TextPiece)[], chars: number, size: number, spacing: number): { width: number; size: number } {
  let width = 0;
  let count = 0;
  let tallest = 0;
  for (const part of parts) {
    const text = typeof part === "string" ? part : part.text;
    const n = [...text.replace(/\s+/g, " ")].length;
    if (n === 0) continue;
    const own = typeof part === "string" ? null : part.attrs;
    const partSize = own === null ? size : len(own, "font-size") ?? size;
    width += n * (CHAR_EM * partSize + (own === null ? spacing : spacingOf(own, spacing)));
    count += n;
    tallest = Math.max(tallest, partSize);
  }
  // Gli spazi che SVG toglie si tolgono in proporzione.
  return count === 0 ? { width: 0, size } : { width: (width * chars) / count, size: tallest };
}

/// Le righe di un testo come rettangoli: l'altezza va da 0,8 em sopra la
/// linea di base a 0,25 em sotto, la larghezza è 0,6 em per carattere più
/// la spaziatura delle lettere. Un testo in area, largo `wrap`, ha anche il
/// suo riquadro, dalla cima della prima riga al fondo dell'ultima; uno su
/// tracciato ha le lettere lungo `track`.
function textSegments(attrs: readonly PaintAttr[], runs: readonly TextRun[], style: Style, wrap: number | null = null, track: Track | null = null): Segment[] {
  const x = len(attrs, "x") ?? 0;
  let y = len(attrs, "y") ?? 0;
  const segments: Segment[] = [];
  let top: number | null = null;
  let bottom = 0;
  for (const run of runs) {
    if (run.kind === "path") {
      if (track !== null) segments.push(...pathSegments(run, track, style));
      continue;
    }
    if (run.kind !== "span") continue;
    const size = len(run.attrs, "font-size") ?? style.fontSize;
    y += len(run.attrs, "dy") ?? 0;
    top ??= y - ASCENT_EM * size;
    bottom = y + DESCENT_EM * size;
    const lineX = len(run.attrs, "x") ?? x;
    const chars = readable(run.text);
    if (chars === 0) continue;
    const line = lineMeasure(run.parts ?? [run.text], chars, size, spacingOf(run.attrs, style.spacing));
    const anchor = attr(run.attrs, "text-anchor")?.trim() ?? style.anchor;
    segments.push(...rectPath(lineStart(lineX, line.width, anchor), y - ASCENT_EM * line.size, line.width, (ASCENT_EM + DESCENT_EM) * line.size, 0, 0));
  }
  if (wrap !== null && top !== null) segments.push(...rectPath(lineStart(x, wrap, style.anchor), top, wrap, bottom - top, 0, 0));
  return segments;
}

/// Dove comincia sul tracciato `track` il testo `run`: la distanza di
/// `startOffset` dall'inizio del tracciato.
function startOf(run: Extract<TextRun, { kind: "path" }>, track: Track): number {
  const offset = startOffset(run.startOffset ?? "0") ?? { value: 0, share: false };
  return offset.share ? offset.value * track.length : offset.value;
}

/// Le lettere di un testo su tracciato come quadrilateri lungo `track`, a
/// stima come le righe: ognuna larga 0,6 em più la spaziatura, centrata sul
/// suo punto del tracciato e girata come il tracciato lì. Una lettera il cui
/// centro cade fuori dal tracciato non si vede, e non si tocca.
function pathSegments(run: Extract<TextRun, { kind: "path" }>, track: Track, style: Style): Segment[] {
  // I caratteri da leggere, con gli spazi in fila che ne valgono uno e
  // nessuno ai bordi, ciascuno col corpo e la spaziatura del suo pezzo.
  const glyphs: Array<{ readonly space: boolean; readonly size: number; readonly width: number }> = [];
  for (const part of run.parts ?? [run.text]) {
    const own = typeof part === "string" ? null : part.attrs;
    const size = own === null ? style.fontSize : len(own, "font-size") ?? style.fontSize;
    const width = CHAR_EM * size + (own === null ? style.spacing : spacingOf(own, style.spacing));
    for (const char of typeof part === "string" ? part : part.text) {
      const space = /\s/.test(char);
      if (space && (glyphs.length === 0 || glyphs[glyphs.length - 1]!.space)) continue;
      glyphs.push({ space, size, width });
    }
  }
  while (glyphs.length > 0 && glyphs[glyphs.length - 1]!.space) glyphs.pop();
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
  let at = lineStart(startOf(run, track), total, style.anchor);
  const segments: Segment[] = [];
  for (const glyph of glyphs) {
    const middle = at + glyph.width / 2;
    at += glyph.width;
    if (glyph.space || middle < 0 || middle > track.length) continue;
    const here = track.at(middle);
    if (here === null) continue;
    const [dx, dy] = here.direction;
    // Sopra la linea di base è a sinistra della direzione.
    const [ux, uy] = [dy, -dx];
    const half = glyph.width / 2;
    const rise = ASCENT_EM * glyph.size;
    const drop = DESCENT_EM * glyph.size;
    const [px, py] = here.at;
    const corner = (along: number, up: number): Point => [px + dx * along + ux * up, py + dy * along + uy * up];
    segments.push(
      { kind: "move", to: corner(-half, rise) },
      { kind: "line", to: corner(half, rise) },
      { kind: "line", to: corner(half, -drop) },
      { kind: "line", to: corner(-half, -drop) },
      { kind: "close" },
    );
  }
  return segments;
}

/// Come si vede il testo `shape` con lo stile `style`, che comprende i suoi
/// attributi: la prima riga dà ancoraggio e corpo. Il passo è quello che
/// l'operazione `text` dà a una riga nuova: il `dy` dell'ultima riga dopo la
/// prima che lo scrive, oppure 1,25 volte il corpo dell'ultima riga.
function textLook(shape: PaintShape | null, style: Style, wrap: number | null = null, track: Track | null = null): TextLook {
  const attrs = shape?.attrs ?? [];
  const path = shape?.runs?.find((run) => run.kind === "path");
  if (path !== undefined && path.kind === "path") {
    // Il campo sta dove il testo comincia sul tracciato, girato come lui.
    const start = track?.at(startOf(path, track)) ?? null;
    const anchor = style.anchor.trim();
    return {
      x: start?.at[0] ?? 0,
      y: start?.at[1] ?? 0,
      size: style.fontSize,
      leading: style.fontSize * 1.25,
      anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
      family: style.family,
      weight: style.weight,
      color: style.color,
      wrap: null,
      along: start?.direction ?? [1, 0],
    };
  }
  const spans = (shape?.runs ?? []).filter((run) => run.kind === "span");
  const first = spans[0]?.attrs ?? [];
  const size = len(first, "font-size") ?? style.fontSize;
  let step: number | null = null;
  for (let k = spans.length - 1; k >= 1 && step === null; k--) step = len(spans[k]!.attrs, "dy");
  const last = spans.length === 0 ? style.fontSize : len(spans[spans.length - 1]!.attrs, "font-size") ?? style.fontSize;
  const anchor = attr(first, "text-anchor")?.trim() ?? style.anchor;
  return {
    x: len(first, "x") ?? len(attrs, "x") ?? 0,
    y: (len(attrs, "y") ?? 0) + (len(first, "dy") ?? 0),
    size,
    leading: step !== null && step > 0 ? step : last * 1.25,
    anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
    family: attr(first, "font-family")?.trim() ?? style.family,
    weight: attr(first, "font-weight")?.trim() ?? style.weight,
    color: attr(first, "fill")?.trim() ?? style.color,
    wrap,
    along: null,
  };
}

/// Il riquadro nella scena delle righe `lines` scritte come `look`, con
/// `matrix` dalle coordinate del testo a quelle della scena: la stessa stima
/// con cui poi le si tocca. `null` se non c'è niente da leggere.
export function linesBounds(look: TextLook, lines: readonly string[], matrix: Matrix): Bounds | null {
  const out = new BoundsBuilder();
  // Un testo su tracciato sta lungo il suo tracciato, non in righe.
  if (look.along !== null) return null;
  if (look.wrap !== null && lines.length > 0) {
    const top = look.y - ASCENT_EM * look.size;
    out.path(rectPath(lineStart(look.x, look.wrap, look.anchor), top, look.wrap, (lines.length - 1) * look.leading + (ASCENT_EM + DESCENT_EM) * look.size, 0, 0), matrix);
  }
  lines.forEach((line, i) => {
    const chars = readable(line);
    if (chars === 0) return;
    const width = CHAR_EM * look.size * chars;
    const left = lineStart(look.x, width, look.anchor);
    const top = look.y + i * look.leading - ASCENT_EM * look.size;
    out.path(rectPath(left, top, width, (ASCENT_EM + DESCENT_EM) * look.size, 0, 0), matrix);
  });
  return out.finish();
}

/// Una riga di un testo che uno strumento sta per scrivere, come la legge il
/// painter.
function elemLine(child: Elem): TextRun {
  const attrs: PaintAttr[] = Object.entries(child.attrs);
  if (child.runs === undefined) return { kind: "span", attrs, space: null, text: child.text ?? "" };
  const parts = child.runs.map((run): string | TextPiece => (typeof run === "string" ? run : { attrs: Object.entries(run.attrs), space: null, text: run.text }));
  return { kind: "span", attrs, space: null, text: parts.map((part) => (typeof part === "string" ? part : part.text)).join(""), parts };
}

/// Il riquadro nella scena di una forma che uno strumento sta per scrivere,
/// contorno compreso: la stessa geometria con cui poi la si tocca. `matrix`
/// porta le coordinate del livello nella scena.
export function elemBounds(elem: Elem, matrix: Matrix): Bounds | null {
  const attrs: PaintAttr[] = Object.entries(elem.attrs);
  const style = styleOf(INITIAL, attrs);
  const bounds = transformedBounds(elemSegments(elem, attrs, style), matrix);
  if (bounds === null) return null;
  const out = new BoundsBuilder();
  includeInflated(out, bounds, style.stroke ? (style.strokeWidth / 2) * scaleOf(matrix) : 0);
  return out.finish();
}

/// Il riquadro della geometria di `elem` nelle sue coordinate, senza il
/// contorno: quello su cui si misura una sfumatura.
export function geometryBox(elem: Elem): Bounds | null {
  const attrs: PaintAttr[] = Object.entries(elem.attrs);
  return transformedBounds(elemSegments(elem, attrs, styleOf(INITIAL, attrs)), IDENTITY);
}

function elemSegments(elem: Elem, attrs: readonly PaintAttr[], style: Style): readonly Segment[] {
  const wrap = elem.attrs["fub:wrap"];
  return elem.tag === "text"
    ? textSegments(attrs, (elem.children ?? []).map(elemLine), style, wrap === undefined ? null : length(wrap))
    : shapeSegments(elem.tag, attrs);
}

// ---------------------------------------------------------------------------
// Marcatori.
// ---------------------------------------------------------------------------

/// Le forme su cui i browser disegnano i marcatori.
const MARKED: ReadonlySet<string> = new Set(["path", "line", "polyline", "polygon"]);

/// Le proprietà dei marcatori, coi vertici dove ciascuna li mette.
const MARKER_PROPERTIES: ReadonlyArray<readonly [MarkerPlace, string]> = [["start", "marker-start"], ["mid", "marker-mid"], ["end", "marker-end"]];

/// Una forma del contenuto di un marcatore: i segmenti, la matrice dalle sue
/// coordinate a quelle del contenuto, e come si tocca.
interface MarkerShape {
  readonly segments: readonly Segment[];
  readonly matrix: Matrix;
  readonly fill: boolean;
  readonly radius: number;
}

/// Un marcatore vivo: come si mette su un vertice, e le forme del suo
/// contenuto già tagliate dalla sua finestra.
interface MarkerLook {
  readonly fit: MarkerFit;
  readonly shapes: readonly MarkerShape[];
}

/// Il marcatore vivo `resource`; `null` se non disegna niente. Il contenuto
/// non eredita niente da chi lo usa: parte dallo stile iniziale.
function markerLook(resource: PaintResource): MarkerLook | null {
  const fit = markerFit((name) => attr(resource.attrs, name));
  if (fit === null) return null;
  const shapes: MarkerShape[] = [];
  contentShapes(resource.children, IDENTITY, INITIAL, fit.clip, shapes);
  return { fit, shapes };
}

/// Le forme di `children`, il contenuto di un marcatore o di un suo gruppo,
/// con `matrix` dalle loro coordinate a quelle del contenuto. Un testo non
/// conta: dentro un marcatore non se ne stima il riquadro.
function contentShapes(children: readonly (PaintDef | string)[], matrix: Matrix, style: Style, clip: Bounds, out: MarkerShape[]): void {
  for (const child of children) {
    if (typeof child === "string" || hidden(child.attrs)) continue;
    const m = compose(matrix, transformOf(child.attrs));
    const inner = styleOf(style, child.attrs);
    if (child.tag === "g") {
      contentShapes(child.children, m, inner, clip, out);
      continue;
    }
    const segments = shapeSegments(child.tag, child.attrs);
    const fill = child.tag !== "line" && inner.fill;
    const radius = inner.stroke ? inner.strokeWidth / 2 : 0;
    if (segments.length > 0 && (fill || radius > 0)) clipShape(out, { segments, matrix: m, fill, radius }, clip);
  }
}

/// Aggiunge a `out` la forma `shape`, tagliata dalla finestra `clip`: intera
/// se ci sta, il rettangolo che resta dentro se ne esce in parte, niente se
/// ne sta fuori. Un'uscita di un miliardesimo della finestra è un errore
/// d'arrotondamento: la forma ci sta.
function clipShape(out: MarkerShape[], shape: MarkerShape, clip: Bounds): void {
  const bounds = transformedBounds(shape.segments, shape.matrix);
  if (bounds === null) return;
  const by = shape.radius * scaleOf(shape.matrix);
  const box: Bounds = { min: [bounds.min[0] - by, bounds.min[1] - by], max: [bounds.max[0] + by, bounds.max[1] + by] };
  const slack = 1e-9 * Math.max(clip.max[0] - clip.min[0], clip.max[1] - clip.min[1]);
  const room: Bounds = { min: [clip.min[0] - slack, clip.min[1] - slack], max: [clip.max[0] + slack, clip.max[1] + slack] };
  if (holds(room, box)) {
    out.push(shape);
    return;
  }
  const [x0, y0] = [Math.max(box.min[0], clip.min[0]), Math.max(box.min[1], clip.min[1])];
  const [x1, y1] = [Math.min(box.max[0], clip.max[0]), Math.min(box.max[1], clip.max[1])];
  if (x1 > x0 && y1 > y0) out.push({ segments: rectPath(x0, y0, x1 - x0, y1 - y0, 0, 0), matrix: IDENTITY, fill: true, radius: 0 });
}

// ---------------------------------------------------------------------------
// Ritagli e maschere.
// ---------------------------------------------------------------------------

/// Il ritaglio o la maschera `resource`; `null` se non è né l'uno né l'altra.
/// Il contenuto non eredita niente da chi lo usa: parte dallo stile iniziale.
function clipLook(resource: PaintResource): ClipLook | null {
  const units = (name: string): string | undefined => attr(resource.attrs, name)?.trim();
  const shapes: ClipShape[] = [];
  if (resource.tag === "mask") {
    maskShapes(resource.children, IDENTITY, INITIAL, shapes);
    return { mask: true, boxContent: units("maskContentUnits") === "objectBoundingBox", transform: IDENTITY, window: windowOf(resource.attrs, units("maskUnits") !== "userSpaceOnUse"), shapes };
  }
  if (resource.tag !== "clipPath") return null;
  clipShapes(resource.children, IDENTITY, units("clip-rule") === "evenodd", shapes);
  return { mask: false, boxContent: units("clipPathUnits") === "objectBoundingBox", transform: transformOf(resource.attrs), window: null, shapes };
}

/// La finestra di una maschera: di `attrs`, in frazioni del riquadro con
/// `box`, dove -10% -10% 120% 120% sono i valori che mancano. In unità
/// utente, se manca un lato la finestra non limita.
function windowOf(attrs: readonly PaintAttr[], box: boolean): ClipWindow | null {
  const read = (name: string, fallback: number | null): number | null => {
    const value = attr(attrs, name);
    if (value === undefined) return fallback;
    return box ? fraction(value) : length(value);
  };
  const x = read("x", box ? -0.1 : null);
  const y = read("y", box ? -0.1 : null);
  const width = read("width", box ? 1.2 : null);
  const height = read("height", box ? 1.2 : null);
  return x === null || y === null || width === null || height === null ? null : { box, x, y, width, height };
}

/// Le forme di `children`, il contenuto di una maschera o di un suo gruppo,
/// con `matrix` dalle loro coordinate a quelle del contenuto: quelle che
/// dipingono, col riempimento o col contorno. Un testo conta nel riquadro
/// stimato delle sue righe.
function maskShapes(children: readonly (PaintDef | string)[], matrix: Matrix, style: Style, out: ClipShape[]): void {
  for (const child of children) {
    if (typeof child === "string" || hidden(child.attrs)) continue;
    const m = compose(matrix, transformOf(child.attrs));
    const inner = styleOf(style, child.attrs);
    if (child.tag === "g") {
      maskShapes(child.children, m, inner, out);
      continue;
    }
    const text = child.tag === "text";
    const segments = text ? textSegments(child.attrs, defRuns(child), inner) : shapeSegments(child.tag, child.attrs);
    const fill = text || (child.tag !== "line" && inner.fill);
    const radius = !text && inner.stroke ? inner.strokeWidth / 2 : 0;
    if (segments.length > 0 && (fill || radius > 0)) out.push({ segments, matrix: m, fill, radius, evenodd: false });
  }
}

/// Le forme di `children`, il contenuto di un ritaglio, che non ha gruppi:
/// quelle che riempiono, qualunque sia il loro riempimento e il loro
/// contorno, ciascuna con la `clip-rule` che scrive o quella `evenodd` del
/// ritaglio. Una linea non ha area e non conta.
function clipShapes(children: readonly (PaintDef | string)[], matrix: Matrix, evenodd: boolean, out: ClipShape[]): void {
  for (const child of children) {
    if (typeof child === "string" || hidden(child.attrs) || child.tag === "line" || child.tag === "g") continue;
    const rule = attr(child.attrs, "clip-rule")?.trim();
    const segments = child.tag === "text" ? textSegments(child.attrs, defRuns(child), styleOf(INITIAL, child.attrs)) : shapeSegments(child.tag, child.attrs);
    if (segments.length > 0) out.push({ segments, matrix: compose(matrix, transformOf(child.attrs)), fill: true, radius: 0, evenodd: rule === undefined ? evenodd : rule === "evenodd" });
  }
}

/// Le righe di un `text` del contenuto di una risorsa, come le legge
/// `textSegments`.
function defRuns(text: PaintDef): TextRun[] {
  const runs: TextRun[] = [];
  for (const line of text.children) {
    if (typeof line === "string" || line.tag !== "tspan") continue;
    const parts: Array<string | TextPiece> = [];
    let pieces = false;
    for (const part of line.children) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      pieces = true;
      parts.push({ attrs: part.attrs, space: part.space, text: defText(part) });
    }
    const content = parts.map((part) => (typeof part === "string" ? part : part.text)).join("");
    runs.push(pieces ? { kind: "span", attrs: line.attrs, space: line.space, text: content, parts } : { kind: "span", attrs: line.attrs, space: line.space, text: content });
  }
  return runs;
}

/// Il testo di `def` e di tutto ciò che contiene.
function defText(def: PaintDef): string {
  return def.children.map((child) => (typeof child === "string" ? child : defText(child))).join("");
}

// ---------------------------------------------------------------------------
// Blocchi estranei.
// ---------------------------------------------------------------------------

/// Quante forme si stimano in un blocco estraneo: oltre, il blocco conta
/// come il suo riquadro, che costa poco da toccare.
const MAX_ESTIMATES = 2048;

/// Quanti elementi si visitano per stimare un blocco: un `use` che ne
/// ripete altri non fa durare la stima più di così.
const MAX_VISITS = 100_000;

/// Quanti `use` si attraversano uno dentro l'altro.
const MAX_USE_DEPTH = 8;

/// Le proprietà che la stima legge anche dal `style` di un elemento.
const ESTIMATED: ReadonlySet<string> = new Set(["display", "visibility", "fill", "stroke", "stroke-width", "font-size", "text-anchor"]);

/// Una forma stimata di un blocco estraneo: i segmenti nelle sue coordinate,
/// la matrice da queste a quelle del contenitore del blocco, se si tocca
/// dentro, e metà del contorno nelle sue unità.
interface Estimate {
  readonly segments: readonly Segment[];
  readonly matrix: Matrix;
  readonly fill: boolean;
  readonly radius: number;
  readonly cache: ShapeCache;
}

/// La stima di un blocco per lo stile che eredita, con gli elementi fuori
/// dal blocco a cui rimanda: vale finché lo stile è lo stesso e ogni id
/// porta ancora allo stesso elemento.
interface Estimated {
  readonly style: Style;
  readonly refs: ReadonlyArray<readonly [string, ElementPart | null]>;
  readonly shapes: readonly Estimate[];
}

/// Una stima in corso: le forme, finché sono poche, poi solo il riquadro.
interface Estimating {
  readonly refs: Array<readonly [string, ElementPart | null]>;
  readonly out: Estimate[];
  box: BoundsBuilder | null;
  visits: number;
}

/// Stima le forme dei blocchi estranei, e le ricorda per blocco.
class ForeignShapes {
  private readonly fragments = new WeakMap<LeafNode, Fragment | null>();
  private readonly ids = new WeakMap<XmlDocument, Map<string, NodeId>>();
  private readonly estimates = new WeakMap<LeafNode, Estimated>();

  constructor(
    private readonly builder: PaintBuilder,
    private readonly holder: Holder | null,
  ) {}

  /// Le forme di `leaf`, che eredita `style`, nelle coordinate del suo
  /// contenitore.
  shapes(leaf: LeafNode, style: Style): readonly Estimate[] {
    const known = this.estimates.get(leaf);
    if (known !== undefined && sameStyle(known.style, style) && known.refs.every(([id, node]) => this.holder?.(id) === node)) {
      return known.shapes;
    }
    const run: Estimating = { refs: [], out: [], box: null, visits: 0 };
    const fragment = this.fragment(leaf);
    if (fragment !== null) this.element(fragment.doc, fragment.id, IDENTITY, style, true, 0, run);
    const shapes = run.box === null ? run.out : boxEstimate(run.box);
    this.estimates.set(leaf, { style, refs: run.refs, shapes });
    return shapes;
  }

  private fragment(leaf: LeafNode): Fragment | null {
    let fragment = this.fragments.get(leaf);
    if (fragment === undefined) {
      fragment = leaf.parent === null ? null : parseFragment(leaf.raw, this.builder.scopeInfo(leaf.parent).scope);
      this.fragments.set(leaf, fragment);
    }
    return fragment;
  }

  /// Le forme dell'elemento `id` di `doc`, con `matrix` dalle coordinate di
  /// chi lo contiene a quelle del contenitore del blocco. `visible` è la
  /// `visibility` che eredita: un figlio di un elemento invisibile può
  /// tornare visibile.
  private element(doc: XmlDocument, id: NodeId, matrix: Matrix, style: Style, visible: boolean, depth: number, run: Estimating): void {
    if (++run.visits > MAX_VISITS) return;
    const element = doc.element(id);
    if (element === null || element.ns !== NS_SVG) return;
    const attrs = presentation(element);
    if (hidden(attrs)) return;
    const m = compose(matrix, transformOf(attrs));
    const inner = styleOf(style, attrs);
    const visibility = attr(attrs, "visibility")?.trim();
    const shown = visibility === undefined || visibility === "inherit" ? visible : visibility === "visible";
    switch (element.local) {
      case "g":
      case "a":
      case "switch":
        this.children(doc, element, m, inner, shown, depth, run);
        return;
      case "svg": {
        // Un documento annidato con le sue misure taglia ciò che contiene;
        // senza, è grande quanto chi lo contiene, e conta il contenuto.
        const box = boxOf(attrs);
        if (box === null) this.children(doc, element, compose(m, translate(len(attrs, "x") ?? 0, len(attrs, "y") ?? 0)), inner, shown, depth, run);
        else if (shown) addEstimate(run, box, m, true, 0);
        return;
      }
      case "use":
        this.use(doc, attrs, m, inner, shown, depth, run);
        return;
      case "image":
      case "foreignObject": {
        const box = boxOf(attrs);
        if (box !== null && shown) addEstimate(run, box, m, true, 0);
        return;
      }
      case "text": {
        const segments = shown ? foreignText(doc, element, attrs, inner) : [];
        if (segments.length > 0) addEstimate(run, segments, m, true, 0);
        return;
      }
      case "path":
      case "rect":
      case "circle":
      case "ellipse":
      case "line":
      case "polyline":
      case "polygon": {
        const segments = shapeSegments(element.local, attrs);
        const fill = element.local !== "line" && inner.fill;
        const radius = inner.stroke ? inner.strokeWidth / 2 : 0;
        if (shown && segments.length > 0 && (fill || radius > 0)) addEstimate(run, segments, m, fill, radius);
        return;
      }
      default:
        // `defs`, `symbol`, i ritagli, le maschere, i motivi e i gradienti
        // si disegnano solo da chi li usa.
        return;
    }
  }

  private children(doc: XmlDocument, element: ElementNode, matrix: Matrix, style: Style, visible: boolean, depth: number, run: Estimating): void {
    for (const child of element.children) this.element(doc, child, matrix, style, visible, depth, run);
  }

  /// Un `use`: l'elemento a cui rimanda, spostato di `x` e `y`, con lo stile
  /// del `use`. Una risorsa fuori dal documento non si legge.
  private use(doc: XmlDocument, attrs: readonly PaintAttr[], matrix: Matrix, style: Style, visible: boolean, depth: number, run: Estimating): void {
    if (depth >= MAX_USE_DEPTH) return;
    const target = attr(attrs, "href")?.trim();
    if (target === undefined || !target.startsWith("#")) return;
    const found = this.find(doc, target.slice(1), run);
    if (found === null) return;
    const placed = compose(matrix, translate(len(attrs, "x") ?? 0, len(attrs, "y") ?? 0));
    const element = found.doc.element(found.id)!;
    if (element.ns === NS_SVG && element.local === "symbol") this.symbol(found.doc, element, attrs, placed, style, visible, depth + 1, run);
    else this.element(found.doc, found.id, placed, style, visible, depth + 1, run);
  }

  /// Un `symbol` disegnato da un `use`: il suo `viewBox` sta nel riquadro
  /// del `use`, centrato e intero come vuole il `preserveAspectRatio`
  /// predefinito; senza misure, il contenuto resta com'è.
  private symbol(
    doc: XmlDocument,
    symbol: ElementNode,
    useAttrs: readonly PaintAttr[],
    matrix: Matrix,
    style: Style,
    visible: boolean,
    depth: number,
    run: Estimating,
  ): void {
    const attrs = presentation(symbol);
    if (hidden(attrs)) return;
    const box = numberList(attr(attrs, "viewBox") ?? "");
    const width = len(useAttrs, "width") ?? len(attrs, "width");
    const height = len(useAttrs, "height") ?? len(attrs, "height");
    let m = matrix;
    if (box !== null && box.length === 4 && box[2]! > 0 && box[3]! > 0 && width !== null && height !== null && width > 0 && height > 0) {
      const scale = Math.min(width / box[2]!, height / box[3]!);
      m = compose(matrix, [scale, 0, 0, scale, (width - box[2]! * scale) / 2 - box[0]! * scale, (height - box[3]! * scale) / 2 - box[1]! * scale]);
    }
    this.children(doc, symbol, m, styleOf(style, attrs), visible, depth, run);
  }

  /// L'elemento di id `id`: nello stesso frammento, o fuori dal blocco, e
  /// allora la stima se lo ricorda.
  private find(doc: XmlDocument, id: string, run: Estimating): { readonly doc: XmlDocument; readonly id: NodeId } | null {
    const local = this.idsOf(doc).get(id);
    if (local !== undefined) return { doc, id: local };
    if (this.holder === null) return null;
    const node = this.holder(id);
    run.refs.push([id, node]);
    // Un contenitore del disegno cambia sotto lo stesso oggetto: non si
    // stima da qui.
    if (node === null || node.kind !== "leaf") return null;
    const fragment = this.fragment(node);
    const found = fragment === null ? undefined : this.idsOf(fragment.doc).get(id);
    return found === undefined ? null : { doc: fragment!.doc, id: found };
  }

  private idsOf(doc: XmlDocument): Map<string, NodeId> {
    let ids = this.ids.get(doc);
    if (ids === undefined) {
      const out = new Map<string, NodeId>();
      doc.nodes.forEach((node, index) => {
        if (node.kind !== "element") return;
        const id = valueOf(node, NS_NONE, "id");
        if (id !== undefined && !out.has(id)) out.set(id, index);
      });
      this.ids.set(doc, (ids = out));
    }
    return ids;
  }
}

function estimate(segments: readonly Segment[], matrix: Matrix, fill: boolean, radius: number): Estimate {
  return { segments, matrix, fill, radius, cache: { segments, scene: null, local: undefined } };
}

/// Aggiunge una forma alla stima `run`: oltre `MAX_ESTIMATES` forme, solo
/// al riquadro.
function addEstimate(run: Estimating, segments: readonly Segment[], matrix: Matrix, fill: boolean, radius: number): void {
  if (run.box === null && run.out.length < MAX_ESTIMATES) {
    run.out.push(estimate(segments, matrix, fill, radius));
    return;
  }
  if (run.box === null) {
    run.box = new BoundsBuilder();
    for (const shape of run.out) includeShape(run.box, shape.segments, shape.matrix, shape.radius);
    run.out.length = 0;
  }
  includeShape(run.box, segments, matrix, radius);
}

function includeShape(out: BoundsBuilder, segments: readonly Segment[], matrix: Matrix, radius: number): void {
  const bounds = transformedBounds(segments, matrix);
  if (bounds !== null) includeInflated(out, bounds, radius * scaleOf(matrix));
}

/// Due stili che danno la stessa geometria.
function sameStyle(a: Style, b: Style): boolean {
  return a === b || (a.fill === b.fill && a.stroke === b.stroke && a.strokeWidth === b.strokeWidth && a.fontSize === b.fontSize && a.anchor === b.anchor);
}

/// Gli attributi di un elemento estraneo che la stima legge: quelli senza
/// namespace, e prima le dichiarazioni del suo `style` che contano, che
/// valgono di più, l'ultima per prima. `xlink:href` vale come `href` se
/// `href` manca.
function presentation(element: ElementNode): PaintAttr[] {
  const out: PaintAttr[] = [];
  const style = valueOf(element, NS_NONE, "style");
  if (style !== undefined) {
    for (const declaration of style.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      if (ESTIMATED.has(name)) out.unshift([name, declaration.slice(colon + 1).replace(/!\s*important\s*$/i, "").trim()]);
    }
  }
  for (const each of element.attrs) if (each.ns === NS_NONE) out.push([each.local, each.value]);
  const xlink = valueOf(element, NS_XLINK, "href");
  if (xlink !== undefined) out.push(["href", xlink]);
  return out;
}

/// Il rettangolo `x`, `y`, `width`, `height` di un elemento; `null` se un
/// lato non è una lunghezza positiva.
function boxOf(attrs: readonly PaintAttr[]): Segment[] | null {
  const width = len(attrs, "width");
  const height = len(attrs, "height");
  if (width === null || height === null || !(width > 0) || !(height > 0)) return null;
  return rectPath(len(attrs, "x") ?? 0, len(attrs, "y") ?? 0, width, height, 0, 0);
}

/// La prima lunghezza di una lista come quelle di `x` e `y` di un testo.
function firstLength(attrs: readonly PaintAttr[], name: string): number | null {
  const value = attr(attrs, name)?.trim();
  if (value === undefined || value === "") return null;
  return length(value.split(/[\s,]+/)[0]!);
}

/// I pezzi di un testo estraneo come rettangoli, con la stima dei testi del
/// disegno: ogni pezzo comincia dove lo mette il suo `tspan`, o dove finisce
/// il pezzo prima.
function foreignText(doc: XmlDocument, text: ElementNode, attrs: readonly PaintAttr[], style: Style): Segment[] {
  const segments: Segment[] = [];
  let x = (firstLength(attrs, "x") ?? 0) + (firstLength(attrs, "dx") ?? 0);
  let y = (firstLength(attrs, "y") ?? 0) + (firstLength(attrs, "dy") ?? 0);
  const piece = (value: string, at: Style): void => {
    const chars = readable(value);
    if (chars === 0) return;
    const width = CHAR_EM * at.fontSize * chars;
    for (const segment of rectPath(lineStart(x, width, at.anchor), y - ASCENT_EM * at.fontSize, width, (ASCENT_EM + DESCENT_EM) * at.fontSize, 0, 0)) {
      segments.push(segment);
    }
    x += at.anchor === "middle" ? width / 2 : at.anchor === "end" ? 0 : width;
  };
  const visit = (element: ElementNode, at: Style): void => {
    for (const id of element.children) {
      const node = doc.nodes[id]!;
      if (node.kind === "text" || node.kind === "cdata") piece(node.value, at);
      else if (node.kind === "entity-ref") piece(doc.plainEntity(node.name) ?? "?", at);
      else if (node.kind === "element" && node.ns === NS_SVG && (node.local === "tspan" || node.local === "textPath" || node.local === "a")) {
        const own = presentation(node);
        if (hidden(own)) continue;
        x = firstLength(own, "x") ?? x;
        y = firstLength(own, "y") ?? y;
        x += firstLength(own, "dx") ?? 0;
        y += firstLength(own, "dy") ?? 0;
        visit(node, styleOf(at, own));
      }
    }
  };
  visit(text, style);
  return segments;
}

/// Il riquadro di tante forme come una sola: piena, senza contorno.
function boxEstimate(out: BoundsBuilder): Estimate[] {
  const box = out.finish();
  if (box === null) return [];
  return [estimate(rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0), IDENTITY, true, 0)];
}

// ---------------------------------------------------------------------------
// Riquadri.
// ---------------------------------------------------------------------------

function localBounds(part: Part): Bounds | null {
  const cache = part.cache!;
  if (cache.local === undefined) cache.local = transformedBounds(part.segments, IDENTITY);
  return cache.local;
}

/// Vero se `inner` sta tutto dentro `outer`.
function holds(outer: Bounds, inner: Bounds): boolean {
  return inner.min[0] >= outer.min[0] && inner.max[0] <= outer.max[0] && inner.min[1] >= outer.min[1] && inner.max[1] <= outer.max[1];
}

function includeInflated(out: BoundsBuilder, bounds: Bounds, by: number): void {
  out.include([bounds.min[0] - by, bounds.min[1] - by]);
  out.include([bounds.max[0] + by, bounds.max[1] + by]);
}

/// Aggiunge a `out` ciò che si vede della forma `part` il cui riquadro senza
/// contorno è `bounds`: allargato di `by` e tagliato da ogni regione di
/// `part`, misurate in `space`. Una forma tagliata via non aggiunge niente.
function includeSeen(out: BoundsBuilder, part: Part, bounds: Bounds, by: number, space: Space): void {
  if (part.regions === null) {
    includeInflated(out, bounds, by);
    return;
  }
  const seen = cut(inflate(bounds, by), part.regions, space);
  if (seen !== null) includeInflated(out, seen, 0);
}

/// Le regioni di ritagli e maschere che non fanno parte di un oggetto, come
/// quelle di un livello su un blocco estraneo: non hanno coordinate
/// dell'oggetto e non si spostano con nessuno.
function fixed(clips: readonly Clip[] | null): readonly Region[] | null {
  return clips === null ? null : clips.map((clip) => new Region(clip, null, false));
}

/// Vero se il segmento da `a` a `b`, allargato di `tolerance`, incontra
/// `bounds`.
function near(bounds: Bounds | null, a: Point, b: Point, tolerance: number): boolean {
  if (bounds === null) return false;
  return Math.max(a[0], b[0]) + tolerance >= bounds.min[0] && Math.min(a[0], b[0]) - tolerance <= bounds.max[0]
    && Math.max(a[1], b[1]) + tolerance >= bounds.min[1] && Math.min(a[1], b[1]) - tolerance <= bounds.max[1];
}

// ---------------------------------------------------------------------------
// Appiattimento.
// ---------------------------------------------------------------------------

function flatten(part: Solid): Flat {
  if (part.flat !== null) return part.flat;
  const m = part.matrix;
  const runs: Run[] = [];
  let points: number[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  const push = (p: Point): void => {
    points.push(p[0], p[1]);
  };
  const finish = (closed: boolean): void => {
    if (points.length >= 2) runs.push({ points: Float64Array.from(points), closed });
    points = [];
  };
  for (const segment of part.segments) {
    switch (segment.kind) {
      case "move":
        finish(false);
        current = segment.to;
        start = segment.to;
        push(apply(m, current));
        break;
      case "line":
        if (points.length === 0) push(apply(m, current));
        push(apply(m, segment.to));
        current = segment.to;
        break;
      case "quad": {
        if (points.length === 0) push(apply(m, current));
        const p0 = apply(m, current);
        const p1 = apply(m, segment.control);
        const p2 = apply(m, segment.to);
        const dd = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
        const n = steps(Math.sqrt((0.25 * dd) / FLATNESS));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
        }
        current = segment.to;
        break;
      }
      case "cubic": {
        if (points.length === 0) push(apply(m, current));
        const p0 = apply(m, current);
        const p1 = apply(m, segment.c1);
        const p2 = apply(m, segment.c2);
        const p3 = apply(m, segment.to);
        const dd = Math.max(
          Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
          Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
        );
        const n = steps(Math.sqrt((0.75 * dd) / FLATNESS));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
        }
        current = segment.to;
        break;
      }
      case "arc":
        if (points.length === 0) push(apply(m, current));
        for (const p of arcPoints(current, segment.radii, segment.rotation, segment.large, segment.sweep, segment.to, m)) push(p);
        current = segment.to;
        break;
      case "close":
        if (points.length === 0) push(apply(m, current));
        finish(true);
        current = start;
        break;
    }
  }
  finish(false);
  part.flat = { runs, radius: part.radius * scaleOf(m) };
  return part.flat;
}

function steps(estimate: number): number {
  return Number.isFinite(estimate) ? Math.min(MAX_STEPS, Math.max(1, Math.ceil(estimate))) : 1;
}

/// I punti di un arco ellittico dopo `from`, fino a `to` compreso, portati
/// nella scena da `m`: la conversione al centro delle note di SVG (F.6.5).
function arcPoints(from: Point, radii: Point, rotation: number, large: boolean, sweep: boolean, to: Point, m: Matrix): Point[] {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  const arc = arcCenter(from, { kind: "arc", radii, rotation, large, sweep, to });
  if (arc === null) return [apply(m, to)];
  // Il passo angolare che tiene la corda entro `FLATNESS` dall'arco, sul
  // raggio più grande nella scena.
  const radius = Math.max(arc.radii[0], arc.radii[1]) * Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
  const angle = radius > FLATNESS ? 2 * Math.acos(fmin(1, 1 - FLATNESS / radius)) : Math.PI / 2;
  const n = steps(Math.abs(arc.delta) / angle);
  const out: Point[] = [];
  for (let i = 1; i < n; i++) out.push(apply(m, onEllipse(arc, arc.start + (arc.delta * i) / n)));
  out.push(apply(m, to));
  return out;
}

// ---------------------------------------------------------------------------
// Prove di contatto.
// ---------------------------------------------------------------------------

/// Il numero di avvolgimento di `p` rispetto a tutti i sottotracciati, chiusi
/// come li chiude il riempimento.
function winding(flat: Flat, p: Point): number {
  let total = 0;
  const [px, py] = p;
  for (const run of flat.runs) {
    const pts = run.points;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = pts[2 * i]!;
      const ay = pts[2 * i + 1]!;
      const j = i + 1 === n ? 0 : i + 1;
      const bx = pts[2 * j]!;
      const by = pts[2 * j + 1]!;
      if (ay <= py) {
        if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) total++;
      } else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) {
        total--;
      }
    }
  }
  return total;
}

/// Ogni lato dei sottotracciati: quelli chiusi anche dall'ultimo punto al
/// primo, e quelli aperti di un riempimento.
function forEachEdge(flat: Flat, fill: boolean, visit: (ax: number, ay: number, bx: number, by: number) => boolean): boolean {
  for (const run of flat.runs) {
    const pts = run.points;
    const n = pts.length / 2;
    if (n === 1 && visit(pts[0]!, pts[1]!, pts[0]!, pts[1]!)) return true;
    for (let i = 0; i + 1 < n; i++) {
      if (visit(pts[2 * i]!, pts[2 * i + 1]!, pts[2 * i + 2]!, pts[2 * i + 3]!)) return true;
    }
    if (n > 2 && (run.closed || fill) && visit(pts[2 * n - 2]!, pts[2 * n - 1]!, pts[0]!, pts[1]!)) return true;
  }
  return false;
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/// La distanza fra i segmenti `ab` e `cd`: zero se si incrociano.
function segmentDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegmentDistance(ax, ay, cx, cy, dx, dy),
    pointSegmentDistance(bx, by, cx, cy, dx, dy),
    pointSegmentDistance(cx, cy, ax, ay, bx, by),
    pointSegmentDistance(dx, dy, ax, ay, bx, by),
  );
}

function partBounds(part: Solid): Bounds | null {
  const cache = part.cache;
  if (cache !== null && cache.scene !== null && sameMatrix(cache.scene.matrix, part.matrix)) return cache.scene.bounds;
  return transformedBounds(part.segments, part.matrix);
}

/// Vero se `p` sta dentro il riempimento di `solid`, appiattito in `flat`,
/// con la sua regola.
function covers(solid: Solid, flat: Flat, p: Point): boolean {
  const turns = winding(flat, p);
  return solid.evenodd === true ? (turns & 1) !== 0 : turns !== 0;
}

/// Vero se il punto `p` tocca la forma `solid`, ignorando ritagli e maschere:
/// dentro il riempimento, o a meno della tolleranza dal suo contorno.
function solidHits(solid: Solid, p: Point, tolerance: number): boolean {
  const radius = solid.radius * scaleOf(solid.matrix);
  if (!near(partBounds(solid), p, p, tolerance + radius)) return false;
  const flat = flatten(solid);
  if (solid.fill && covers(solid, flat, p)) return true;
  const reach = flat.radius + tolerance;
  return forEachEdge(flat, solid.fill, (ax, ay, bx, by) => pointSegmentDistance(p[0], p[1], ax, ay, bx, by) <= reach);
}

/// Vero se `p` sta dentro ogni ritaglio e ogni maschera di `regions`, con la
/// stessa tolleranza di una forma: dentro la finestra di una maschera e
/// dentro, o vicino, a una forma del contenuto.
function regionsHit(regions: readonly Region[], p: Point, tolerance: number): boolean {
  for (const { clip } of regions) {
    const window = clip.windowSolid();
    if (window !== null && !solidHits(window, p, tolerance)) return false;
    if (!clip.solids().some((solid) => solidHits(solid, p, tolerance))) return false;
  }
  return true;
}

/// Vero se `p` tocca la parte che si vede di `part`: la forma, dove i
/// ritagli e le maschere che la tagliano la lasciano.
function partHits(part: Part, p: Point, tolerance: number): boolean {
  return solidHits(part, p, tolerance) && (part.regions === null || regionsHit(part.regions, p, tolerance));
}

/// Che cosa colora `part` nel punto `p`: il contorno, che sta sopra, il
/// riempimento, o niente. Il contorno di un sottotracciato aperto non ha il
/// lato che il riempimento chiude. Dove un ritaglio o una maschera nasconde
/// la forma non colora niente.
function partSample(part: Part, p: Point, tolerance: number): Sampled["on"] | null {
  const radius = part.radius * scaleOf(part.matrix);
  if (!near(partBounds(part), p, p, tolerance + radius)) return null;
  if (part.regions !== null && !regionsHit(part.regions, p, tolerance)) return null;
  const flat = flatten(part);
  const away = edgeDistance(flat, false, p);
  if (flat.radius > 0 && away <= flat.radius) return "stroke";
  if (part.fill && covers(part, flat, p)) return "fill";
  if (tolerance <= 0) return null;
  if (flat.radius > 0) return away <= flat.radius + tolerance ? "stroke" : null;
  return part.fill && edgeDistance(flat, true, p) <= tolerance ? "fill" : null;
}

/// La distanza di `p` dal lato più vicino di `flat`; con `fill` anche dai
/// lati che chiudono i sottotracciati aperti.
function edgeDistance(flat: Flat, fill: boolean, p: Point): number {
  let best = Infinity;
  forEachEdge(flat, fill, (ax, ay, bx, by) => {
    best = Math.min(best, pointSegmentDistance(p[0], p[1], ax, ay, bx, by));
    return false;
  });
  return best;
}

function solidTouches(solid: Solid, a: Point, b: Point, tolerance: number): boolean {
  const radius = solid.radius * scaleOf(solid.matrix);
  if (!near(partBounds(solid), a, b, tolerance + radius)) return false;
  const flat = flatten(solid);
  if (solid.fill && (covers(solid, flat, a) || covers(solid, flat, b))) return true;
  const reach = flat.radius + tolerance;
  return forEachEdge(flat, solid.fill, (cx, cy, dx, dy) => segmentDistance(a[0], a[1], b[0], b[1], cx, cy, dx, dy) <= reach);
}

/// Vero se il segmento da `a` a `b` tocca la parte che si vede di `part`.
/// Si toglie prima ciò che sta fuori dai riquadri dei ritagli e delle
/// maschere, poi si guarda se ciò che resta tocca anche loro e la forma.
function partTouches(part: Part, a: Point, b: Point, tolerance: number): boolean {
  const regions = part.regions;
  if (regions === null) return solidTouches(part, a, b, tolerance);
  let from = a;
  let to = b;
  for (const region of regions) {
    const box = region.clip.sceneBox();
    const kept = box === null ? null : clipSegment(from, to, box, tolerance);
    if (kept === null) return false;
    [from, to] = kept;
  }
  for (const { clip } of regions) {
    const window = clip.windowSolid();
    if (window !== null && !solidTouches(window, from, to, tolerance)) return false;
    if (!clip.solids().some((solid) => solidTouches(solid, from, to, tolerance))) return false;
  }
  return solidTouches(part, from, to, tolerance);
}

/// Vero se `solid` sta tutta dentro il lazo, contorno compreso: nessun lato
/// di `edges`, quelli del lazo che le stanno vicino, arriva al suo contorno,
/// e comincia dentro.
function solidInside(solid: Solid, lasso: Lasso, edges: readonly number[]): boolean {
  const flat = flatten(solid);
  const first = flat.runs[0];
  if (first === undefined) return true;
  const reach = flat.radius;
  const crosses = forEachEdge(flat, solid.fill, (ax, ay, bx, by) => {
    for (let i = 0; i < edges.length; i += 4) {
      if (segmentDistance(ax, ay, bx, by, edges[i]!, edges[i + 1]!, edges[i + 2]!, edges[i + 3]!) <= reach) return true;
    }
    return false;
  });
  return !crosses && lasso.contains([first.points[0]!, first.points[1]!]);
}

/// Vero se tutte le `solids` stanno dentro il lazo, e `box` le contiene.
function allInside(solids: readonly Solid[], box: Bounds, lasso: Lasso): boolean {
  if (!holds(lasso.bounds, box)) return false;
  const edges = lasso.edgesNear(box);
  if (edges.length === 0) return lasso.contains(box.min);
  return solids.every((solid) => solidInside(solid, lasso, edges));
}

/// Il riquadro che contiene le `solids`, contorno compreso.
function solidsBox(solids: readonly Solid[]): Bounds | null {
  const out = new BoundsBuilder();
  for (const solid of solids) {
    const bounds = partBounds(solid);
    if (bounds !== null) includeInflated(out, bounds, solid.radius * scaleOf(solid.matrix));
  }
  return out.finish();
}

/// Vero se ciò che si vede di `part`, tagliata da ritagli o maschere, sta
/// tutto dentro il lazo. Ciò che si vede sta dentro la forma e dentro ogni
/// regione, e anche dentro il riquadro dove le regioni e la forma si
/// incontrano: basta che il lazo contenga uno di loro.
function visibleInside(part: Part, lasso: Lasso): boolean {
  const regions = part.regions!;
  const bounds = partBounds(part);
  if (bounds === null) return true;
  const own = inflate(bounds, part.radius * scaleOf(part.matrix));
  const seen = cut(own, regions, "scene");
  if (seen === null) return true;
  if (allInside([part], own, lasso)) return true;
  for (const { clip } of regions) {
    for (const group of clip.covers()) {
      const box = solidsBox(group);
      if (box !== null && allInside(group, box, lasso)) return true;
    }
  }
  const [x0, y0] = seen.min;
  const [x1, y1] = seen.max;
  const box: Solid = { segments: rectPath(x0, y0, x1 - x0, y1 - y0, 0, 0), matrix: IDENTITY, fill: true, radius: 0, cache: null, flat: null };
  return allInside([box], seen, lasso);
}
