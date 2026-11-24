// L'unità che gli strumenti toccano, con le sue parti, e il blocco estraneo
// (vedi `../hit.ts`).

import type { Role } from "../../scene/analysis";
import { BoundsBuilder, type Bounds } from "../../scene/geometry";
import { compose, IDENTITY, type Matrix, type Point } from "../../scene/matrix";
import { tagName, type ContainerNode, type ElementPart, type LeafNode } from "../../scene/model";
import type { Target } from "../../scene/ops";
import type { PaintNode } from "../../painter/paint";
import { scaleOf, transformedBounds } from "../clips";
import type { Part, Sampled, Style, TextLook } from "./base";
import {
  holds,
  includeSeen,
  type Lasso,
  localBounds,
  near,
  partHits,
  partSample,
  partTouches,
  solidInside,
  visibleInside,
} from "./geometry";

/// Un blocco estraneo, con le forme che se ne stimano: un elemento che il
/// formato dei disegni non sa riscrivere, e che si conserva com'è. Non si
/// sceglie, ma la gomma lo toglie intero (`SceneIndex.along`).
export class ForeignBlock {
  /// Il riquadro nella scena delle forme stimate; `null` se non ne ha.
  readonly bounds: Bounds | null;

  constructor(
    /// Il percorso nel documento.
    readonly path: readonly number[],
    private readonly parts: readonly Part[],
    /// L'elemento.
    readonly node: LeafNode,
  ) {
    const out = new BoundsBuilder();
    for (const part of parts) {
      const box = transformedBounds(part.segments, part.matrix);
      if (box !== null) includeSeen(out, part, box, part.radius * scaleOf(part.matrix), "scene");
    }
    this.bounds = out.finish();
  }

  /// La chiave per la gomma: l'id, o il percorso come per un oggetto che
  /// non ne ha.
  get key(): string {
    return this.node.facts.id ?? `@${this.path.join(".")}`;
  }

  /// Come lo indirizza un'operazione: l'id, o il percorso col tag (formato
  /// della scena, bersaglio).
  get target(): Target {
    return this.node.facts.id ?? { path: this.path, tag: tagName(this.node) };
  }

  /// Vero se il blocco si vede nel punto `p` della scena, entro `tolerance`.
  covers(p: Point, tolerance: number): boolean {
    return this.parts.some((part) => partSample(part, p, tolerance) !== null);
  }

  /// Vero se il segmento da `a` a `b` tocca il blocco, come
  /// [`Unit.touches`].
  touches(a: Point, b: Point, tolerance: number): boolean {
    if (!near(this.bounds, a, b, tolerance)) return false;
    return this.parts.some((part) => partTouches(part, a, b, tolerance));
  }
}

/// Ciò che la gomma toglie: un oggetto, o un blocco estraneo intero.
export type Erasable = Unit | ForeignBlock;

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

/// Come l'indice trova gli oggetti dentro i gruppi.
export interface Nested {
  /// L'oggetto di chiave `key` dove si sceglie, a qualunque profondità;
  /// `null` se non c'è.
  resolve(key: string): Unit | null;
  /// Gli oggetti che si scelgono fra i figli di `container`.
  childrenOf(container: ContainerNode): Unit[];
  /// I blocchi estranei fra i figli di `container`, se è un gruppo o un
  /// collegamento dove si sceglie, in ordine di documento: sempre gli stessi
  /// per lo stesso indice.
  foreignOf(container: ContainerNode): readonly ForeignBlock[];
  /// Il contenitore isolato come oggetto; `null` senza, o se lì non si
  /// sceglie.
  scopeUnit(): Unit | null;
  /// Il contenitore isolato; `null` senza.
  readonly scope: ContainerNode | null;
  /// Le copie fra i figli di `container`, se è una ripetizione dove si
  /// sceglie, come oggetti: non si scelgono, ma dicono dove si vedono.
  copiesOf(container: ContainerNode): Unit[];
}

/// Il passo di percorso di un'unità che non è un figlio nel documento: la
/// forma di una maschera di ritaglio, che sta nel suo `clipPath` e si mostra
/// come un figlio del gruppo che ritaglia, messo prima degli altri.
export const OUTSIDE_TREE = -1;

/// Vero se `unit` non si trova seguendo il suo percorso: il suo nodo è
/// `unit.node`, costruito apposta, e i gesti lo scrivono altrove.
export function outsideTree(unit: { readonly path: readonly number[] }): boolean {
  return unit.path[unit.path.length - 1] === OUTSIDE_TREE;
}
