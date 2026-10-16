// L'editor del disegno: le funzioni di servizio, che più pezzi di
// createDrawEditor condividono.

import { INK_MAX_SAMPLES, type InkSample } from "../../../../ink/sample";
import { validCurve } from "../../../../ink/input/pressure";
import type { Bounds } from "../../scene/geometry";
import { apply, type Matrix, type Point } from "../../scene/matrix";
import { elementChildren, type DocumentModel, type ElementPart } from "../../scene/model";
import { t, type DrawKey } from "../../strings";
import type { Destination } from "../edit";
import { nodeKey, type NodeKey, type NodeKind, type Subpath } from "../nodes";
import { validClosed, validStep, validSteps, type Grid } from "../grid";
import type { LayerInfo } from "../hit";
import { MAX_LAYER_NAME } from "../layers";

/// Il nodo di `model` al percorso `path`; `null` se lì non c'è.
export function nodeAtPath(model: DocumentModel, path: readonly number[]): ElementPart | null {
  let node: ElementPart = model.root;
  for (const at of path) {
    if (node.kind !== "container") return null;
    const next: ElementPart | undefined = elementChildren(node)[at];
    if (next === undefined) return null;
    node = next;
  }
  return node;
}

/// L'ordine di documento di due percorsi: chi contiene prima di ciò che
/// contiene.
export function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

export function holdsPath(outer: readonly number[], inner: readonly number[]): boolean {
  return inner.length > outer.length && outer.every((step, at) => inner[at] === step);
}

/// Un tratto dritto dal primo all'ultimo campione: un campione ogni unità e
/// mezza, con la pressione e il tempo distribuiti in mezzo.
export function straight(samples: readonly InkSample[]): InkSample[] {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined || first === last) return [...samples];
  const steps = Math.min(INK_MAX_SAMPLES - 1, Math.max(1, Math.ceil(Math.hypot(last.x - first.x, last.y - first.y) / 1.5)));
  const out: InkSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    out.push({ ...first, x: first.x + (last.x - first.x) * k, y: first.y + (last.y - first.y) * k, t: first.t + (last.t - first.t) * k });
  }
  return out;
}

export function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/// Vero se `p` sta in `bounds`, bordi compresi.
export function insideBounds(bounds: Bounds, p: Point): boolean {
  return p[0] >= bounds.min[0] && p[0] <= bounds.max[0] && p[1] >= bounds.min[1] && p[1] <= bounds.max[1];
}

export function union(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (a === null || b === null) return a ?? b;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
  };
}

export function translated(bounds: Bounds | null, dx: number, dy: number): Bounds | null {
  return bounds === null ? null : { min: [bounds.min[0] + dx, bounds.min[1] + dy], max: [bounds.max[0] + dx, bounds.max[1] + dy] };
}

/// Vero se i riquadri `a` e `b` non si toccano.
export function disjoint(a: Bounds, b: Bounds): boolean {
  return a.max[0] < b.min[0] || a.min[0] > b.max[0] || a.max[1] < b.min[1] || a.min[1] > b.max[1];
}

export function toLocal(sample: InkSample, inverse: Matrix): InkSample {
  const [x, y] = apply(inverse, [sample.x, sample.y]);
  return { ...sample, x, y };
}

export function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((at, i) => at === b[i]);
}

/// Vero se il nodo `at` ha un segmento da tutti e due i lati: solo lui ha un
/// tipo, e si spezza.
export function innerNode(sub: Subpath, at: number): boolean {
  return sub.closed ? sub.nodes.length > 1 : at > 0 && at < sub.nodes.length - 1;
}

/// I nodi di `subs`, in ordine.
export function allNodes(subs: readonly Subpath[]): NodeKey[] {
  return subs.flatMap((sub, s) => sub.nodes.map((_, at) => nodeKey(s, at)));
}

/// I tipi dati ai nodi, portati dove una modifica porta i nodi.
export function remapped(kinds: ReadonlyMap<NodeKey, NodeKind>, moved: ReadonlyMap<NodeKey, NodeKey>): Map<NodeKey, NodeKind> {
  const out = new Map<NodeKey, NodeKind>();
  for (const [key, kind] of kinds) {
    const to = moved.get(key);
    if (to !== undefined) out.set(to, kind);
  }
  return out;
}

/// I segmenti fra due nodi scelti: se ce n'è uno, se uno non è una linea, e
/// se uno non è una cubica.
export function linksBetween(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>): { readonly any: boolean; readonly toLine: boolean; readonly toCurve: boolean } {
  let any = false;
  let toLine = false;
  let toCurve = false;
  subs.forEach((sub, s) => {
    sub.links.forEach((link, i) => {
      const end = (i + 1) % sub.nodes.length;
      if (end === i || !selected.has(nodeKey(s, i)) || !selected.has(nodeKey(s, end))) return;
      any = true;
      if (link.kind !== "line") toLine = true;
      if (link.kind !== "cubic") toCurve = true;
    });
  });
  return { any, toLine, toCurve };
}

export function sameDestination(a: Destination, b: Destination): boolean {
  return a.parent === b.parent && a.prelude.length === b.prelude.length && a.matrix.every((v, i) => v === b.matrix[i]);
}

export function matrixText(m: Matrix): string {
  return `matrix(${m.join(" ")})`;
}

/// Il nome di un livello come si mostra: gli spazi raccolti e, oltre `max`
/// caratteri, tagliato coi puntini. Un livello senza nome lo dice.
export function layerTitle(layer: LayerInfo, max = MAX_LAYER_NAME): string {
  const name = layer.name.replace(/\s+/g, " ").trim();
  if (name === "") return t("draw.layer.unnamed");
  const chars = Array.from(name);
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/// Lo stato di un livello a parole, come nell'albero degli oggetti: vuoto se
/// si vede e non è bloccato.
export function layerState(layer: LayerInfo): string {
  const parts: string[] = [];
  if (layer.locked) parts.push(t("draw.state.locked"));
  if (layer.hidden) parts.push(t("draw.state.hidden"));
  return parts.join(", ");
}

/// Perché in `layer` non si disegna, o `null` se ci si disegna.
export function layerRefusal(layer: LayerInfo): DrawKey | null {
  return layer.hidden ? "draw.layer.hidden_here" : layer.locked ? "draw.layer.locked_here" : null;
}

/// `next` come griglia, col passo di `before` se il suo è fuori dai limiti,
/// e i passi delle altre unità che la griglia accetta.
export function checkedGrid(next: Grid, before: Grid): Grid {
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
  return {
    shown: next.shown,
    snap: next.snap,
    step: validStep(next.step) ? next.step : before.step,
    steps: typeof next.steps === "object" && next.steps !== null ? validSteps(next.steps) : before.steps,
    guides: flag(next.guides, before.guides),
    rulers: flag(next.rulers, before.rulers),
    rulerGuides: flag(next.rulerGuides, before.rulerGuides),
    panel: next.panel === null || typeof next.panel === "boolean" ? next.panel : before.panel,
    bar: flag(next.bar, before.bar),
    closed: validClosed(next.closed) ?? before.closed,
    shapes: flag(next.shapes, before.shapes),
    twist: flag(next.twist, before.twist),
    taps: flag(next.taps, before.taps),
    pen: validCurve(next.pen) ?? before.pen,
  };
}

/// Il verso di una freccia su un asse.
export function sign(value: number): 1 | -1 {
  return value < 0 ? -1 : 1;
}
