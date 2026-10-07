// La selezione avanzata (livello Standard), per quanto non tocca il foglio:
// scegliere gli oggetti simili a quelli scelti, invertire la selezione, e
// bloccare o nascondere gli oggetti uno per uno, con le operazioni che li
// sbloccano e li mostrano tutti.
//
// - **Simili, a ogni profondità.** Stesso riempimento, contorno o spessore
//   come li legge il pannello delle proprietà (`look.ts`); stesso tipo come
//   lo nomina l'albero degli oggetti, con l'evidenziatore distinto dalla
//   penna; stesso strumento, per i tratti a mano libera, che vuol dire la
//   stessa penna o lo stesso evidenziatore con la stessa punta; stesso
//   livello. Si sceglie anche dentro i gruppi, come in Illustrator: un
//   gruppo conta solo se fra gli oggetti scelti ce n'è uno. Il livello
//   guarda gli oggetti in cima.
// - **Invertire** sceglie tutto il resto: dove un oggetto scelto sta in un
//   gruppo, gli altri del gruppo e non il gruppo intero.
// - **Bloccare e nascondere** scrivono `fub:locked="true"` e
//   `display="none"` sull'oggetto (formato della scena, §3), in un `batch`
//   solo. «Sblocca tutto» e «Mostra tutto» valgono per ciò che si vede e si
//   può cambiare: gli oggetti dei livelli visibili e sbloccati, anche dentro
//   i gruppi, e dentro il gruppo isolato se ce n'è uno. Un gruppo bloccato si
//   sblocca prima di ciò che contiene, nello stesso `batch`; dentro un gruppo
//   bloccato non si mostra niente, e dentro uno nascosto non si sblocca
//   niente, perché non si vedrebbe.

import { parseBrush } from "../ink/brush";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import { fubAttributes, nodeOf, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { lookOf } from "./look";

/// Che cosa hanno in comune gli oggetti simili.
export type Likeness = "fill" | "stroke" | "width" | "kind" | "tool" | "layer";

/// Uno stato che un oggetto ha da solo: bloccato o nascosto.
export type Flag = "locked" | "hidden";

const CONTAINERS: ReadonlySet<string> = new Set(["group", "link"]);

/// Gli oggetti che si scelgono, a ogni profondità, in ordine di documento:
/// chi contiene viene prima di ciò che contiene.
export function allUnits(index: SceneIndex): Unit[] {
  const out: Unit[] = [];
  const visit = (units: readonly Unit[]): void => {
    for (const unit of units) {
      out.push(unit);
      visit(index.children(unit));
    }
  };
  visit(index.units);
  return out;
}

/// La punta di un tratto a mano libera: lo spessore del suo pennello.
function tipOf(node: ElementPart): string {
  try {
    return String(parseBrush(fubAttributes(node).get("brush") ?? "").size);
  } catch {
    return "";
  }
}

/// Ciò che di `unit` conta per `by`, come chiave; `null` se non ne ha.
export function likenessOf(model: DocumentModel, index: SceneIndex, unit: Unit, by: Likeness): string | null {
  const stroke = unit.role === "stroke" ? unit.node.details?.stroke ?? null : null;
  switch (by) {
    case "fill":
      return lookOf(model, [unit]).fill.value;
    case "stroke":
      return lookOf(model, [unit]).stroke.value;
    case "width": {
      const width = lookOf(model, [unit]).width.value;
      return width === null ? null : String(width);
    }
    case "kind":
      return stroke === null ? unit.role : `stroke ${stroke.tool}`;
    case "tool":
      return stroke === null ? null : `${stroke.tool} ${tipOf(unit.node)}`;
    case "layer": {
      const layer = index.layers.find((each) => each.path[0] === unit.path[0]);
      return layer === undefined ? "" : String(layer.path[0]);
    }
  }
}

/// Vero se fra `chosen` c'è qualcosa da cui cercare i simili per `by`.
export function hasLikeness(model: DocumentModel, index: SceneIndex, chosen: readonly Unit[], by: Likeness): boolean {
  return chosen.some((unit) => likenessOf(model, index, unit, by) !== null);
}

/// Gli oggetti simili a `chosen` per `by`, `chosen` compresi, in ordine di
/// documento; `null` se nessuno di `chosen` ha qualcosa da confrontare.
export function similarTo(model: DocumentModel, index: SceneIndex, chosen: readonly Unit[], by: Likeness): Unit[] | null {
  const wanted = new Set<string>();
  for (const unit of chosen) {
    const key = likenessOf(model, index, unit, by);
    if (key !== null) wanted.add(key);
  }
  if (wanted.size === 0) return null;
  const containers = chosen.some((unit) => CONTAINERS.has(unit.role));
  const pool = by === "layer" ? index.units : allUnits(index).filter((unit) => containers || !CONTAINERS.has(unit.role));
  return pool.filter((unit) => {
    const key = likenessOf(model, index, unit, by);
    return key !== null && wanted.has(key);
  });
}

/// Vero se `outer` contiene `inner`, a qualunque profondità.
function holds(outer: Unit, inner: Unit): boolean {
  return inner.path.length > outer.path.length && outer.path.every((step, at) => inner.path[at] === step);
}

/// Tutto ciò che si sceglie tranne `chosen`, in ordine di documento: di un
/// gruppo che contiene un oggetto scelto, gli altri oggetti.
export function inverseOf(index: SceneIndex, chosen: readonly Unit[]): Unit[] {
  const keys = new Set(chosen.map((unit) => unit.key));
  const out: Unit[] = [];
  const visit = (units: readonly Unit[]): void => {
    for (const unit of units) {
      if (keys.has(unit.key)) continue;
      if (chosen.some((each) => holds(unit, each))) visit(index.children(unit));
      else out.push(unit);
    }
  };
  visit(index.units);
  return out;
}

/// Blocca o sblocca, nasconde o mostra `nodes`, in un `batch`: tocca solo
/// quelli che cambiano. Le chiavi sono quelle degli oggetti cambiati.
export function flagOps(model: DocumentModel, nodes: readonly ElementPart[], flag: Flag, on: boolean, ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  const keys: string[] = [];
  for (const node of nodes) {
    if ((node.details?.[flag] === true) === on) continue;
    const id = plan.idOf(node);
    plan.ops.push({ op: "set", id, attrs: flag === "locked" ? { "fub:locked": on ? "true" : null } : { display: on ? "none" : null } });
    keys.push(id);
  }
  return plan.finish(keys);
}

/// I nodi di `units`, per [`flagOps`].
export function nodesOf(model: DocumentModel, units: readonly Unit[]): ElementPart[] {
  return units.map((unit) => nodeOf(model, unit));
}

/// Gli oggetti bloccati o nascosti che «Sblocca tutto» e «Mostra tutto»
/// cambiano, in ordine di documento: dentro `scope`, il gruppo isolato, o in
/// tutto il disegno. I livelli bloccati o nascosti restano come sono, e
/// così ciò che contengono.
export function flagged(model: DocumentModel, scope: ContainerNode | null, flag: Flag): ElementPart[] {
  const other: Flag = flag === "locked" ? "hidden" : "locked";
  const out: ElementPart[] = [];
  const visit = (container: ContainerNode): void => {
    for (const child of elementChildren(container)) {
      const details = child.details;
      if (details === null) continue;
      if (details.role === "layer") {
        const layer = details.layer;
        if (container === model.root && child.kind === "container" && layer !== undefined && !layer.locked && !layer.hidden) visit(child);
        continue;
      }
      if (details.role === "paper" || details.role === "title" || details.role === "desc" || details.role === "defs") continue;
      if (details[flag] === true) out.push(child);
      if (child.kind === "container" && CONTAINERS.has(details.role) && details[other] !== true) visit(child);
    }
  };
  visit(scope ?? model.root);
  return out;
}
