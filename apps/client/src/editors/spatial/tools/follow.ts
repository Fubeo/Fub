// Ciò che serve a chi segue un'operazione nel motore, come i connettori e le
// etichette nelle forme: che cosa l'operazione ha toccato, spostato o
// nominato, e le matrici della scena lette una volta.

import { compose, IDENTITY, type Matrix } from "../scene/matrix";
import type { ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import { transform as parseTransform } from "../scene/values";
import { plainAttributes } from "./arrange";

/// Vero se un contenitore bloccato contiene `node`: il motore non vi scrive.
export function lockedAbove(node: ElementPart): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at.details?.locked === true) return true;
  return false;
}

/// Il `transform` di `node`; uno che non si legge non trasforma, come lo
/// disegna un browser.
export function ownMatrix(node: ElementPart): Matrix {
  // Senza la parola nel tag d'apertura non c'è l'attributo: la maggior parte
  // degli oggetti non si legge.
  if (!(node.kind === "leaf" ? node.raw.slice(0, node.openLength) : node.head).includes("transform")) return IDENTITY;
  const written = plainAttributes(node).get("transform");
  return written === undefined ? IDENTITY : (parseTransform(written) ?? IDENTITY);
}

/// Le matrici della scena di un'operazione: ogni `transform` si legge una
/// volta, e ogni matrice si compone una volta.
export class SceneMatrices {
  private readonly owns = new Map<ElementPart, Matrix>();
  private readonly known = new Map<ElementPart, Matrix>();

  /// Il `transform` di `node` da solo.
  own(node: ElementPart): Matrix {
    let m = this.owns.get(node);
    if (m === undefined) {
      m = ownMatrix(node);
      this.owns.set(node, m);
    }
    return m;
  }

  /// Dalle coordinate di `node` alla scena, col suo `transform`.
  of(node: ElementPart): Matrix {
    if (node.parent === null) return IDENTITY;
    let m = this.known.get(node);
    if (m === undefined) {
      m = compose(this.of(node.parent), this.own(node));
      this.known.set(node, m);
    }
    return m;
  }
}

/// Gli id di cui `op` sposta, gira o ridimensiona l'oggetto: un `set` di
/// `transform` che non riscrive la geometria. «Applica trasformazione»,
/// che porta il `transform` nella geometria, non sposta niente.
export function movedBy(op: Op, out = new Set<string>()): Set<string> {
  if (op.op === "batch") for (const inner of op.ops) movedBy(inner, out);
  else if (op.op === "set" && op.part === undefined && "transform" in op.attrs && !("fub:geom" in op.attrs)) out.add(op.id);
  return out;
}

/// Gli id degli elementi che `op` nomina: quelli che ha cambiato chi l'ha
/// chiesta, non ciò che un seguito ha toccato dopo.
export function namedBy(op: Op, out = new Set<string>()): Set<string> {
  if (op.op === "batch") {
    for (const inner of op.ops) namedBy(inner, out);
    return out;
  }
  const named = op as { readonly id?: unknown; readonly target?: unknown };
  if (typeof named.id === "string") out.add(named.id);
  if (typeof named.target === "string") out.add(named.target);
  return out;
}

/// Vero se `node`, o chi lo contiene, ha l'id in `ids`.
export function among(node: ElementPart, ids: ReadonlySet<string>): boolean {
  for (let at: ElementPart | null = node; at !== null; at = at.parent) if (at.facts.id !== null && ids.has(at.facts.id)) return true;
  return false;
}

/// Che cosa è cambiato: gli oggetti toccati e quelli che li contengono.
export class Changes {
  private readonly hit: ReadonlySet<ElementPart>;
  private readonly inside = new Set<ElementPart>();

  constructor(hit: ReadonlySet<ElementPart>) {
    this.hit = hit;
    for (const node of hit) for (let at: ElementPart | null = node; at !== null && !this.inside.has(at); at = at.parent) this.inside.add(at);
  }

  /// Vero se è cambiato `node` o chi lo contiene: si è spostato con lui.
  under(node: ElementPart): boolean {
    for (let at: ElementPart | null = node; at !== null; at = at.parent) if (this.hit.has(at)) return true;
    return false;
  }

  /// Vero se è cambiato `node`, chi lo contiene o qualcosa che contiene: il
  /// suo contorno può essere un altro.
  changed(node: ElementPart): boolean {
    return this.inside.has(node) || this.under(node);
  }
}

/// Gli oggetti toccati da un'operazione, coi loro id: quelli che ci sono
/// ancora e gli id di quelli tolti.
export function touchedBy(touched: ReadonlySet<string>, find: (id: string) => ElementPart | null): { readonly changes: Changes; readonly removed: ReadonlySet<string> } {
  const removed = new Set<string>();
  const hit = new Set<ElementPart>();
  for (const id of touched) {
    const node = find(id);
    if (node === null) removed.add(id);
    else hit.add(node);
  }
  return { changes: new Changes(hit), removed };
}
