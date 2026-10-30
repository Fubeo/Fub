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
import { compose, type Matrix } from "../scene/matrix";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import { repeatMatrices, type Repeat } from "../scene/repeat";
import type { Elem } from "../scene/serialize";
import { elemOf, Plan, renamed, type Arranged, type Expanding } from "./arrange";
import { relinkCopies } from "./connector-copies";
import { transformValue, type NewIds } from "./edit";
import { lockedAbove, ownMatrix } from "./follow";
import type { Unit } from "./hit";
import { ResourceCopies } from "./resources";

/// I tipi di ripetizione, nell'ordine del menu.
export type RepeatKind = Repeat["kind"];

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
