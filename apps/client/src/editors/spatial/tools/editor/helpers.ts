// L'editor del disegno: le funzioni di servizio, che più pezzi di
// createDrawEditor condividono.

import { validCurve } from "../../../../ink/input/pressure";
import type { Bounds } from "../../scene/geometry";
import type { Matrix } from "../../scene/matrix";
import { elementChildren, type DocumentModel, type ElementPart } from "../../scene/model";
import { t, type DrawKey } from "../../strings";
import type { Destination } from "../edit";
import { isPenId } from "../../../../ink/pens";
import { isBarrelAction, isEraseMode, isFidelity, isPenOutput, validClosed, validSteady, validStep, validSteps, type EraseMode, type Grid, type Steady } from "../grid";
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

export function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
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
    panel: next.panel === null || typeof next.panel === "boolean" ? next.panel : before.panel,
    bar: flag(next.bar, before.bar),
    closed: validClosed(next.closed) ?? before.closed,
    shapes: flag(next.shapes, before.shapes),
    twist: flag(next.twist, before.twist),
    taps: flag(next.taps, before.taps),
    pen: validCurve(next.pen) ?? before.pen,
    // Uno stabilizzatore che non si legge tiene quello di prima.
    ...steadyOf(next.steady === undefined ? undefined : (validSteady(next.steady) ?? before.steady)),
    ...eraserOf(isEraseMode(next.eraser) ? next.eraser : before.eraser),
    ...(isPenId(next.penId) ? { penId: next.penId } : before.penId === undefined ? {} : { penId: before.penId }),
    ...(isBarrelAction(next.barrel) ? { barrel: next.barrel } : before.barrel === undefined ? {} : { barrel: before.barrel }),
    ...(isPenOutput(next.output) ? { output: next.output } : before.output === undefined ? {} : { output: before.output }),
    ...(isFidelity(next.fidelity) ? { fidelity: next.fidelity } : before.fidelity === undefined ? {} : { fidelity: before.fidelity }),
  };
}

/// La gomma come campo della griglia: assente se non è mai stata scelta.
function eraserOf(eraser: EraseMode | undefined): { readonly eraser?: EraseMode } {
  return eraser === undefined ? {} : { eraser };
}

/// Lo stabilizzatore come campo della griglia: assente se è spento da sempre.
function steadyOf(steady: Steady | undefined): { readonly steady?: Steady } {
  return steady === undefined ? {} : { steady };
}

/// Il verso di una freccia su un asse.
export function sign(value: number): 1 | -1 {
  return value < 0 ? -1 : 1;
}
