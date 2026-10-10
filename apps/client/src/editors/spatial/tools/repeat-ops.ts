// Le ripetizioni nell'editor (Disegni, ripetizioni e simmetria; formato
// della scena, ripetizioni): ripetere gli oggetti scelti, cambiare una
// ripetizione, espanderla, separarla e tenerla vera mentre il disegno cambia.
// Ogni comando diventa un `batch` solo, come quelli di `arrange.ts`.
//
// - **Ripeti** mette l'oggetto scelto in un gruppo nuovo con `fub:repeat`,
//   al suo posto, e dopo di lui le copie; più oggetti vanno prima in un
//   gruppo, che diventa l'originale. Su una ripetizione, o sui suoi
//   originali, cambia il tipo. Si comincia da valori che si vedono subito:
//   otto volte intorno a un centro sotto l'originale, lontano quanto basta
//   perché le copie non si tocchino; una griglia di tre per tre, coi passi di
//   un quarto più larghi dell'originale; lo specchio sul suo bordo destro.
// - **Cambiare una ripetizione** riscrive `fub:repeat` e le copie: le loro
//   trasformazioni vengono da lì, e quelle in più o in meno si tolgono o si
//   aggiungono dopo le altre. Il raggio sposta l'originale, gli altri valori
//   no; l'angolo e la distanza dello specchio si misurano dal centro
//   dell'originale.
// - **Espandi** mette al posto di ogni copia un duplicato del suo originale,
//   con id nuovi, la trasformazione che la copia gli dava e le risorse
//   private copiate, come per un duplicato; poi `fub:repeat` se ne va, e
//   resta un gruppo qualunque. **Separa** fa lo stesso, e porta fuori gli
//   oggetti come da ogni gruppo (`arrange.ts`).
// - **Le copie seguono gli originali nuovi.** Un oggetto che entra in una
//   ripetizione, disegnato, incollato o spostato lì, ne è un originale, e
//   riceve le sue copie nello stesso passo d'annulla.

import type { Bounds } from "../scene/geometry";
import { apply, compose, invert, translate, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { AddOp, Op } from "../scene/ops";
import { readRepeat, repeatMatrices, writeRepeat, type Repeat } from "../scene/repeat";
import type { Elem } from "../scene/serialize";
import { elemOf, nodeOf, Plan, renamed, wrapIn, type Arranged, type Expanding } from "./arrange";
import { relinkCopies } from "./connector-copies";
import { transformValue, type NewIds } from "./edit";
import { lockedAbove, ownMatrix } from "./follow";
import type { Unit } from "./hit";
import { ResourceCopies } from "./resources";

/// I tipi di ripetizione, nell'ordine del menu.
export type RepeatKind = Repeat["kind"];
export const REPEAT_KINDS: readonly RepeatKind[] = ["radial", "grid", "mirror"];

/// Quante volte comincia una ripetizione radiale.
const START_RADIAL = 8;

/// Quante colonne e quante righe ha una griglia nuova.
const START_GRID = 3;

/// Il passo di una griglia nuova, in volte il lato dell'originale.
const GRID_SPACING = 1.25;

/// Quanto spazio lascia intorno a ogni copia il raggio di una ripetizione
/// radiale nuova, in volte la larghezza dell'originale.
const RADIAL_SPACING = 1.2;

/// Vero se `node` è una ripetizione: un gruppo con `fub:repeat` che si
/// legge.
export function isRepeatNode(node: ElementPart | null): node is ContainerNode {
  return node !== null && node.kind === "container" && node.details?.role === "group" && node.details.repeat !== undefined;
}

/// Vero se `unit` è una ripetizione.
export function isRepeat(unit: Unit): boolean {
  return isRepeatNode(unit.node);
}

/// Un originale di una ripetizione, con le sue copie in ordine di
/// documento.
export interface Original {
  readonly node: ElementPart;
  readonly copies: readonly ElementPart[];
}

/// Gli originali della ripetizione `container`, in ordine di documento: i
/// figli modificabili con un id, titoli, descrizioni e copie esclusi.
export function repeatOriginals(container: ContainerNode): Original[] {
  const children = elementChildren(container);
  const copies = new Map<string, ElementPart[]>();
  for (const child of children) {
    if (child.details?.role !== "copy") continue;
    const id = child.details.original!;
    copies.set(id, [...(copies.get(id) ?? []), child]);
  }
  const out: Original[] = [];
  for (const child of children) {
    const role = child.details?.role;
    if (role === undefined || role === "title" || role === "desc" || role === "copy" || child.facts.id === null) continue;
    out.push({ node: child, copies: copies.get(child.facts.id) ?? [] });
  }
  return out;
}

/// La ripetizione su cui agisce un comando con `units`: una ripetizione
/// scelta da sola, o quella di cui sono tutti originali; `null` altrimenti.
export function repeatTarget(units: readonly Unit[]): ContainerNode | null {
  if (units.length === 1 && isRepeat(units[0]!)) return units[0]!.node as ContainerNode;
  const parent = units[0]?.node.parent ?? null;
  return isRepeatNode(parent) && units.every((unit) => unit.node.parent === parent) ? parent : null;
}

/// `repeat` come si rilegge dopo averlo scritto, coi numeri del formato: le
/// copie vengono da ciò che il file dice. `null` se scritto non si legge,
/// come uno specchio coi due punti troppo vicini.
function written(repeat: Repeat): Repeat | null {
  return readRepeat(writeRepeat(repeat));
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/// La ripetizione di tipo `kind` con cui comincia un originale che sta in
/// `box`, nelle coordinate della ripetizione: vedi l'intestazione.
export function startRepeat(kind: RepeatKind, box: Bounds): Repeat {
  const width = box.max[0] - box.min[0];
  const height = box.max[1] - box.min[1];
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  switch (kind) {
    case "radial": {
      // Il giro intorno al centro lascia a ogni copia la sua larghezza e un
      // quinto in più; mai meno dell'altezza, perché la punta non tocchi il
      // centro.
      const radius = Math.max(1, Math.round(Math.max(height, (width * START_RADIAL * RADIAL_SPACING) / (2 * Math.PI))));
      return { kind, count: START_RADIAL, center: [round2(cx), round2(cy + radius)] };
    }
    case "grid": {
      const side = (value: number, other: number): number => Math.max(1, Math.round((value > 0 ? value : other > 0 ? other : 1) * GRID_SPACING));
      return { kind, columns: START_GRID, rows: START_GRID, step: [side(width, height), side(height, width)] };
    }
    case "mirror": {
      const x = round2(box.max[0]);
      const top = round2(box.min[1]);
      const bottom = Math.max(round2(box.max[1]), top + 1);
      return { kind, axis: [[x, top], [x, bottom]] };
    }
  }
}

/// Le copie di `repeat` per l'originale `original`, come le scrive
/// un'operazione: un `use` con l'id, la trasformazione e `href`.
export function copyElems(repeat: Repeat, original: string, ids: NewIds): Elem[] {
  return repeatMatrices(repeat).map((m) => {
    const attrs: Record<string, string> = { id: ids.next("object") };
    const value = transformValue(m);
    if (value !== null) attrs.transform = value;
    attrs.href = `#${original}`;
    return { tag: "use", attrs };
  });
}

/// Perché «Ripeti» non si fa: niente che si veda, il livello del più alto
/// schiaccia il piano, o fra gli oggetti c'è un originale di una ripetizione
/// insieme ad altro, che dalla sua ripetizione non esce.
export type RepeatRefusal = "empty" | "flat" | "inside";

/// Un comando sulle ripetizioni: le operazioni, la selezione dopo e la
/// ripetizione.
export interface RepeatMade extends Arranged {
  readonly repeat: Repeat;
}

/// Il riquadro di ciò che si vede di `units` nelle coordinate in cui porta
/// `inverse`, dalla scena; `null` se non si vede niente.
function boxIn(units: readonly Unit[], inverse: Matrix): Bounds | null {
  let out: Bounds | null = null;
  for (const unit of units) {
    const box = unit.boundsAfter(inverse);
    if (box === null) continue;
    out = out === null ? box : { min: [Math.min(out.min[0], box.min[0]), Math.min(out.min[1], box.min[1])], max: [Math.max(out.max[0], box.max[0]), Math.max(out.max[1], box.max[1])] };
  }
  return out;
}

/// «Ripeti» di tipo `kind` con `units`: vedi l'intestazione. `originals`
/// dà gli originali di una ripetizione come oggetti, che dicono dove si
/// vedono.
export function repeatOps(model: DocumentModel, units: readonly Unit[], kind: RepeatKind, ids: NewIds, originals: (container: ContainerNode) => readonly Unit[]): RepeatMade | RepeatRefusal {
  const target = repeatTarget(units);
  if (target !== null) {
    const shown = originals(target);
    const inverse = shown.length === 0 ? null : invert(shown[0]!.parent);
    if (inverse === null) return shown.length === 0 ? "empty" : "flat";
    const box = boxIn(shown, inverse);
    if (box === null) return "empty";
    const repeat = written(startRepeat(kind, box));
    if (repeat === null) return "empty";
    const keys = units.length === 1 && units[0]!.node === target ? [] : units.map((unit) => unit.key);
    return rewriteOps(model, target, repeat, ids, null, keys);
  }
  if (units.some((unit) => isRepeatNode(unit.node.parent))) return "inside";
  const ordered = [...units].sort((a, b) => comparePaths(a.path, b.path));
  const top = ordered[ordered.length - 1];
  if (top === undefined) return "empty";
  const inverse = invert(top.parent);
  if (inverse === null) return "flat";
  const box = boxIn(ordered, inverse);
  if (box === null) return "empty";
  const repeat = written(startRepeat(kind, box));
  if (repeat === null) return "empty";
  const plan = new Plan(model, ids);
  const value = writeRepeat(repeat);
  let group: string;
  let original: string;
  if (ordered.length === 1) {
    group = wrapIn(plan, ordered, "g", { "fub:repeat": value })!;
    original = plan.idOf(nodeOf(model, top));
  } else {
    // Più oggetti vanno prima in un gruppo, che è l'originale.
    original = wrapIn(plan, ordered, "g", {})!;
    group = ids.next("object");
    plan.ops.push(
      { op: "add", parent: plan.parentOf(nodeOf(model, top)), pos: { after: original }, elem: { tag: "g", attrs: { id: group, "fub:repeat": value }, children: [] } },
      { op: "move", target: original, parent: group, pos: { last: true } },
    );
  }
  for (const elem of copyElems(repeat, original, ids)) plan.ops.push({ op: "add", parent: group, pos: { last: true }, elem });
  return { ...plan.finish([group]), repeat };
}

/// Le operazioni che danno alla ripetizione `node` la forma `repeat`, con i
/// numeri del formato: `fub:repeat`, e le copie di ogni originale
/// riscritte, tolte o aggiunte dopo le altre. `move`, se c'è, sposta gli
/// originali di tanto nelle coordinate della ripetizione. La selezione dopo
/// è `keys`, o la ripetizione se è vuoto.
export function rewriteOps(model: DocumentModel, node: ContainerNode, repeat: Repeat, ids: NewIds, move: Point | null = null, keys: readonly string[] = []): RepeatMade {
  const plan = new Plan(model, ids);
  const group = plan.idOf(node);
  const value = writeRepeat(repeat);
  if (node.details?.repeat === undefined || writeRepeat(node.details.repeat) !== value) plan.ops.push({ op: "set", id: group, attrs: { "fub:repeat": value } });
  const matrices = repeatMatrices(repeat);
  const adds: AddOp[] = [];
  const removes: Op[] = [];
  for (const { node: original, copies } of repeatOriginals(node)) {
    const id = original.facts.id!;
    if (move !== null && (move[0] !== 0 || move[1] !== 0)) {
      plan.ops.push({ op: "set", id, attrs: { transform: transformValue(compose(translate(move[0], move[1]), ownMatrix(original))) } });
    }
    let after = id;
    copies.forEach((copy, at) => {
      const copyId = plan.idOf(copy);
      if (at >= matrices.length) {
        removes.push({ op: "remove", target: copyId });
        return;
      }
      after = copyId;
      const next = transformValue(matrices[at]!);
      if (next !== transformValue(ownMatrix(copy))) plan.ops.push({ op: "set", id: copyId, attrs: { transform: next } });
    });
    const missing = copyElems(repeat, id, ids).slice(copies.length);
    for (const elem of missing) {
      adds.push({ op: "add", parent: group, pos: { after }, elem });
      after = elem.attrs.id!;
    }
  }
  plan.ops.push(...removes, ...adds);
  return { ...plan.finish(keys.length === 0 ? [group] : keys), repeat };
}

/// Gli elementi che prendono il posto delle copie di `container`: per ogni
/// copia un duplicato del suo originale, con id nuovi, i connettori di
/// dentro rivolti alle copie e la trasformazione che la copia gli dava. Le
/// risorse private si copiano, e le loro operazioni vanno in `plan`. `null`
/// se un originale ha parti che non si copiano.
export const expandCopiesIn: Expanding = (plan, container) => {
  const resources = new ResourceCopies(plan.model, plan.ids, elemOf);
  const out = new Map<ElementPart, Elem>();
  for (const { node, copies } of repeatOriginals(container)) {
    if (copies.length === 0) continue;
    const elem = elemOf(node);
    if (elem === null) return null;
    const own = ownMatrix(node);
    for (const copy of copies) {
      const made = new Map<string, string>();
      const duplicate = resources.adopt(renamed(elem, plan.ids, made));
      if (duplicate === null) return null;
      const linked = relinkCopies([duplicate], made)[0]!;
      const attrs: Record<string, string> = { ...linked.attrs };
      const value = transformValue(compose(ownMatrix(copy), own));
      if (value === null) delete attrs.transform;
      else attrs.transform = value;
      out.set(copy, { ...linked, attrs });
    }
  }
  plan.ops.push(...resources.ops());
  return out;
};

/// Perché «Espandi» non si fa: niente da espandere, o un originale ha parti
/// che non si copiano.
export type ExpandRefusal = "none" | "content";

/// Le ripetizioni che «Espandi» espande con `units`: quelle scelte e
/// quelle di cui sono originali, in ordine.
export function expandTargets(units: readonly Unit[]): ContainerNode[] {
  const targets: ContainerNode[] = [];
  for (const unit of units) {
    const target = isRepeat(unit) ? (unit.node as ContainerNode) : isRepeatNode(unit.node.parent) ? unit.node.parent : null;
    if (target !== null && !targets.includes(target)) targets.push(target);
  }
  return targets;
}

/// «Espandi» le ripetizioni fra `units`, o quella di cui sono originali:
/// vedi l'intestazione. La selezione resta.
export function expandOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged | ExpandRefusal {
  const targets = expandTargets(units);
  if (targets.length === 0) return "none";
  const plan = new Plan(model, ids);
  const steps: Op[] = [];
  for (const target of targets) {
    const group = plan.idOf(target);
    const swaps = expandCopiesIn(plan, target);
    if (swaps === null) return "content";
    for (const [copy, elem] of swaps) {
      const copyId = plan.idOf(copy);
      steps.push({ op: "add", parent: group, pos: { after: copyId }, elem }, { op: "remove", target: copyId });
    }
    steps.push({ op: "set", id: group, attrs: { "fub:repeat": null } });
  }
  plan.ops.push(...steps);
  return plan.finish(units.map((unit) => plan.keyOf(unit.node, unit.key)));
}

/// Il seguito delle ripetizioni dopo un'operazione che ha toccato
/// `touched`: ogni originale senza copie di una ripetizione toccata, o di
/// quella in cui sta un oggetto toccato, riceve le sue, subito dopo di lui.
/// Una ripetizione bloccata, o in un contenitore bloccato, resta com'è.
/// `null` se non c'è niente da fare.
export function followRepeats(model: DocumentModel, touched: ReadonlySet<string>, find: (id: string) => ElementPart | null, ids: NewIds): Op | null {
  const groups = new Set<ContainerNode>();
  for (const id of touched) {
    const node = find(id);
    if (node === null) continue;
    if (isRepeatNode(node)) groups.add(node);
    if (isRepeatNode(node.parent)) groups.add(node.parent);
  }
  if (groups.size === 0) return null;
  const plan = new Plan(model, ids);
  for (const group of groups) {
    if (group.details?.locked === true || lockedAbove(group)) continue;
    for (const { node, copies } of repeatOriginals(group)) {
      if (copies.length > 0) continue;
      const parent = plan.idOf(group);
      const original = node.facts.id!;
      let after = original;
      for (const elem of copyElems(group.details!.repeat!, original, ids)) {
        plan.ops.push({ op: "add", parent, pos: { after }, elem });
        after = elem.attrs.id!;
      }
    }
  }
  const { ops } = plan.finish([]);
  return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { op: "batch", ops: [...ops] };
}

// ---------------------------------------------------------------------------
// I valori del pannello.
// ---------------------------------------------------------------------------

/// Dove sta una ripetizione: `matrix` dalle sue coordinate alla scena, e il
/// riquadro dei suoi originali nelle sue coordinate.
export interface RepeatPlace {
  readonly matrix: Matrix;
  readonly box: Bounds;
}

/// Dove sta la ripetizione degli originali `shown`, gli oggetti che si
/// scelgono quando la si isola; `null` se non ce ne sono, se non disegnano
/// niente o se la ripetizione schiaccia il piano.
export function repeatPlace(shown: readonly Unit[]): RepeatPlace | null {
  const matrix = shown[0]?.parent;
  const inverse = matrix === undefined ? null : invert(matrix);
  if (matrix === undefined || inverse === null) return null;
  const box = boxIn(shown, inverse);
  return box === null ? null : { matrix, box };
}

/// Vero se `value` è un tipo di ripetizione.
export function isRepeatKind(value: unknown): value is RepeatKind {
  return REPEAT_KINDS.includes(value as RepeatKind);
}

/// Ciò che il pannello mostra di una ripetizione, nella scena: per una
/// radiale quante volte, il centro e il raggio, dal centro a quello degli
/// originali; per una griglia colonne, righe e i passi lungo i suoi assi;
/// per uno specchio l'angolo dell'asse, in gradi da 0 a 180, e la sua
/// distanza dal centro degli originali, positiva se l'asse sta dalla parte
/// di (sin a, −cos a): a destra di lui se è verticale, sopra se è
/// orizzontale.
export type RepeatView =
  | { readonly kind: "radial"; readonly count: number; readonly center: Point; readonly radius: number }
  | { readonly kind: "grid"; readonly columns: number; readonly rows: number; readonly step: Point }
  | { readonly kind: "mirror"; readonly angle: number; readonly distance: number };

/// Un valore cambiato nel pannello.
export type RepeatEdit =
  | { readonly field: "count" | "columns" | "rows"; readonly value: number }
  | { readonly field: "center-x" | "center-y" | "radius" | "step-x" | "step-y" | "angle" | "distance"; readonly value: number };

/// Il centro di `box`.
function middle(box: Bounds): Point {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];
}

/// Quanto la parte lineare di `m` allunga i due assi.
function axisScales(m: Matrix): Point {
  return [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])];
}

/// La parte lineare di `m` su `v`.
function linear(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

/// L'angolo in gradi di `v`, da 0 a 180: un asse non ha verso.
function axisAngle([x, y]: Point): number {
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  const folded = ((degrees % 180) + 180) % 180;
  return folded >= 180 - 1e-9 ? 0 : folded;
}

/// La direzione di un asse di `angle` gradi, e la sua normale (sin a,
/// −cos a).
function axisFrame(angle: number): { readonly along: Point; readonly normal: Point } {
  const r = (angle * Math.PI) / 180;
  const along: Point = [Math.cos(r), Math.sin(r)];
  return { along, normal: [along[1], -along[0]] };
}

/// Ciò che il pannello mostra di `repeat`, che sta in `place`.
export function repeatView(repeat: Repeat, place: RepeatPlace): RepeatView {
  const { matrix } = place;
  const origin = apply(matrix, middle(place.box));
  switch (repeat.kind) {
    case "radial": {
      const center = apply(matrix, repeat.center);
      return { kind: "radial", count: repeat.count, center, radius: Math.hypot(origin[0] - center[0], origin[1] - center[1]) };
    }
    case "grid": {
      const [sx, sy] = axisScales(matrix);
      return { kind: "grid", columns: repeat.columns, rows: repeat.rows, step: [repeat.step[0] * sx, repeat.step[1] * sy] };
    }
    case "mirror": {
      const a = apply(matrix, repeat.axis[0]);
      const b = apply(matrix, repeat.axis[1]);
      const angle = axisAngle([b[0] - a[0], b[1] - a[1]]);
      const { normal } = axisFrame(angle);
      return { kind: "mirror", angle, distance: (a[0] - origin[0]) * normal[0] + (a[1] - origin[1]) * normal[1] };
    }
  }
}

/// La ripetizione dopo `edit`, con i numeri del formato, e di quanto si
/// spostano gli originali nelle coordinate della ripetizione; `null` se il
/// valore non va, se non cambia niente o se la ripetizione schiaccia il
/// piano.
export function editedRepeat(repeat: Repeat, place: RepeatPlace, edit: RepeatEdit): { readonly repeat: Repeat; readonly move: Point | null } | null {
  const inverse = invert(place.matrix);
  if (inverse === null || !Number.isFinite(edit.value)) return null;
  const view = repeatView(repeat, place);
  let next: Repeat | null = null;
  let move: Point | null = null;
  switch (edit.field) {
    case "count":
      if (repeat.kind === "radial") next = { ...repeat, count: Math.round(edit.value) };
      break;
    case "columns":
    case "rows":
      if (repeat.kind === "grid") next = { ...repeat, [edit.field]: Math.round(edit.value) };
      break;
    case "center-x":
    case "center-y":
      if (view.kind === "radial") {
        const center: Point = edit.field === "center-x" ? [edit.value, view.center[1]] : [view.center[0], edit.value];
        next = { ...(repeat as Extract<Repeat, { kind: "radial" }>), center: apply(inverse, center) };
      }
      break;
    case "radius":
      if (view.kind === "radial" && edit.value >= 0) {
        // Gli originali si allontanano dal centro, o vi si avvicinano, lungo
        // la retta che li unisce; dal centro esatto, verso l'alto.
        const origin = apply(place.matrix, middle(place.box));
        const away: Point = view.radius > 1e-9 ? [(origin[0] - view.center[0]) / view.radius, (origin[1] - view.center[1]) / view.radius] : [0, -1];
        const shift = edit.value - view.radius;
        move = linear(inverse, [away[0] * shift, away[1] * shift]);
        next = repeat;
      }
      break;
    case "step-x":
    case "step-y":
      if (repeat.kind === "grid") {
        const [sx, sy] = axisScales(place.matrix);
        const scale = edit.field === "step-x" ? sx : sy;
        if (scale > 0) next = { ...repeat, step: edit.field === "step-x" ? [edit.value / scale, repeat.step[1]] : [repeat.step[0], edit.value / scale] };
      }
      break;
    case "angle":
    case "distance":
      if (view.kind === "mirror") {
        const angle = edit.field === "angle" ? edit.value : view.angle;
        const distance = edit.field === "distance" ? edit.value : view.distance;
        const { along, normal } = axisFrame(angle);
        const origin = apply(place.matrix, middle(place.box));
        const foot: Point = [origin[0] + normal[0] * distance, origin[1] + normal[1] * distance];
        // I due punti stanno ai lati del piede, lontani quanto mezzo
        // originale: l'asse si vede accanto a lui.
        const corner = apply(place.matrix, place.box.max);
        const reach = Math.max(1, Math.hypot(corner[0] - origin[0], corner[1] - origin[1]));
        const a = apply(inverse, [foot[0] - along[0] * reach, foot[1] - along[1] * reach]);
        const b = apply(inverse, [foot[0] + along[0] * reach, foot[1] + along[1] * reach]);
        next = { kind: "mirror", axis: [a, b] };
      }
      break;
  }
  if (next === null) return null;
  const read = written(next);
  if (read === null) return null;
  if (move === null && writeRepeat(read) === writeRepeat(repeat)) return null;
  return { repeat: read, move };
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
