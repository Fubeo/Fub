// I livelli del disegno (livello Standard): crearli, rinominarli, nasconderli
// e bloccarli, cambiarne l'ordine, eliminarli, e portarci gli oggetti scelti.
// Ogni comando è un `batch` solo, come quelli di `arrange.ts`, così annulla e
// ripeti lo disfano intero.
//
// - **Un livello** è un `g` figlio della radice con `fub:layer` (formato della
//   scena, §3). Il nome sta lì, al più [`MAX_LAYER_NAME`] caratteri; bloccato
//   è `fub:locked="true"`, nascosto è `display="none"`, che lo nasconde anche
//   negli altri programmi.
// - **Gli id prima di tutto**, come in `arrange.ts`: un livello o un oggetto
//   senza id, che il comando deve nominare, lo riceve con `ident` in testa.
// - **Spostare oggetti in un livello** li porta in cima, nell'ordine in cui
//   stavano, con la trasformazione che li lascia dove si vedevano.

import { compose, invert } from "../scene/matrix";
import { elementChildren, type ContainerNode, type DocumentModel } from "../scene/model";
import { ROOT } from "../scene/ops";
import { nodeOf, Plan, type Arranged } from "./arrange";
import { transformValue, type NewIds } from "./edit";
import type { LayerInfo, Unit } from "./hit";
import { carriedTo } from "./place";

/// La lunghezza massima del nome di un livello, in caratteri.
export const MAX_LAYER_NAME = 80;

/// Dove si sposta un livello: sopra quello che ha sopra, o sotto quello che
/// ha sotto.
export type Shift = "up" | "down";

/// I figli della radice che vengono prima dei livelli.
const HEAD: ReadonlySet<string> = new Set(["title", "desc", "paper", "board"]);

/// Il nodo del modello di un livello.
function layerNode(model: DocumentModel, layer: LayerInfo): ContainerNode {
  return elementChildren(model.root)[layer.path[0]!] as ContainerNode;
}

/// Il nome di un livello com'è scritto: senza spazi ai bordi e al più
/// [`MAX_LAYER_NAME`] caratteri. Vuoto se non resta niente.
export function layerName(input: string): string {
  return Array.from(input.trim()).slice(0, MAX_LAYER_NAME).join("").trimEnd();
}

/// Il nome di un livello nuovo: `nameFor(n)` col primo `n`, dal numero dei
/// livelli più uno, che nessun livello porta già.
export function freshLayerName(layers: readonly LayerInfo[], nameFor: (n: number) => string): string {
  const taken = new Set(layers.map((layer) => layer.name));
  let n = layers.length + 1;
  while (taken.has(nameFor(n))) n++;
  return nameFor(n);
}

/// Un livello nuovo e vuoto col nome `name`, subito sopra `above`, o in cima
/// se non c'è. La chiave che torna è il suo id.
export function addLayerOps(model: DocumentModel, above: LayerInfo | null, name: string, ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  const id = ids.next("layer");
  const pos = above === null ? { last: true as const } : { after: plan.idOf(layerNode(model, above), "layer") };
  plan.ops.push({ op: "add", parent: ROOT, pos, elem: { tag: "g", attrs: { id, "fub:layer": name }, children: [] } });
  return plan.finish([id]);
}

/// Cambia gli attributi di un livello; un valore `null` toglie l'attributo.
/// La chiave che torna è il suo id.
function setLayer(model: DocumentModel, layer: LayerInfo, attrs: Readonly<Record<string, string | null>>, ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  const id = plan.idOf(layerNode(model, layer), "layer");
  plan.ops.push({ op: "set", id, attrs });
  return plan.finish([id]);
}

/// Dà a un livello il nome `name`, già pulito da [`layerName`]. Nessuna
/// operazione se il nome è lo stesso.
export function renameLayerOps(model: DocumentModel, layer: LayerInfo, name: string, ids: NewIds): Arranged {
  if (name === layer.name) return { ops: [], keys: [] };
  return setLayer(model, layer, { "fub:layer": name }, ids);
}

/// Nasconde o mostra un livello.
export function hideLayerOps(model: DocumentModel, layer: LayerInfo, hidden: boolean, ids: NewIds): Arranged {
  if (hidden === layer.hidden) return { ops: [], keys: [] };
  return setLayer(model, layer, { display: hidden ? "none" : null }, ids);
}

/// Blocca o sblocca un livello.
export function lockLayerOps(model: DocumentModel, layer: LayerInfo, locked: boolean, ids: NewIds): Arranged {
  if (locked === layer.locked) return { ops: [], keys: [] };
  return setLayer(model, layer, { "fub:locked": locked ? "true" : null }, ids);
}

/// La posizione di `layer` fra `layers`, che sono in ordine di documento.
function placeOf(layers: readonly LayerInfo[], layer: LayerInfo): number {
  return layers.findIndex((other) => other.path[0] === layer.path[0]);
}

/// Vero se `layer` si sposta verso `shift`: c'è un livello da scavalcare.
export function canShiftLayer(layers: readonly LayerInfo[], layer: LayerInfo, shift: Shift): boolean {
  const at = placeOf(layers, layer);
  return at >= 0 && (shift === "up" ? at < layers.length - 1 : at > 0);
}

/// Porta `layer` sopra il livello che ha sopra, o sotto quello che ha sotto.
/// Si muove solo lui: ciò che sta alla radice fra i due resta dov'era
/// rispetto a tutto il resto. La chiave che torna è il suo id.
export function shiftLayerOps(model: DocumentModel, layers: readonly LayerInfo[], layer: LayerInfo, shift: Shift, ids: NewIds): Arranged {
  if (!canShiftLayer(layers, layer, shift)) return { ops: [], keys: [] };
  const at = placeOf(layers, layer);
  const plan = new Plan(model, ids);
  const self = plan.idOf(layerNode(model, layer), "layer");
  if (shift === "up") {
    const over = plan.idOf(layerNode(model, layers[at + 1]!), "layer");
    plan.ops.push({ op: "move", target: self, parent: ROOT, pos: { after: over } });
    return plan.finish([self]);
  }
  // Sotto quello di sotto: dopo ciò che gli sta subito sotto, o per primo
  // dopo titolo, descrizione e carta.
  const under = layers[at - 1]!;
  const below = elementChildren(model.root)[under.path[0]! - 1];
  if (below === undefined || HEAD.has(below.details?.role ?? "")) {
    plan.ops.push({ op: "move", target: self, parent: ROOT, pos: { first: true } });
  } else if (below.details === null || (below.details.role === "defs" && below.facts.id === null)) {
    // Un elemento estraneo non riceve un id, e la `defs` della radice uno
    // qualunque: è il livello di sotto a salire sopra questo.
    plan.ops.push({ op: "move", target: plan.idOf(layerNode(model, under), "layer"), parent: ROOT, pos: { after: self } });
  } else {
    const after = below.details.role === "defs" ? below.facts.id! : plan.idOf(below, below.details.role === "layer" ? "layer" : "object");
    plan.ops.push({ op: "move", target: self, parent: ROOT, pos: { after } });
  }
  return plan.finish([self]);
}

/// Toglie un livello con tutto ciò che contiene.
export function removeLayerOps(layer: LayerInfo): Arranged {
  const target = layer.id ?? { path: layer.path, tag: "g" };
  return { ops: [{ op: "remove", target }], keys: [] };
}

/// Vero se `unit` sta in `layer`.
export function inLayer(unit: Unit, layer: LayerInfo): boolean {
  return unit.path.length > 1 && unit.path[0] === layer.path[0];
}

/// Porta in cima a `layer` gli oggetti di `units` che stanno altrove,
/// nell'ordine in cui stavano, con la trasformazione che li lascia dove si
/// vedevano e lo stile che ereditavano, come uno spostamento nell'albero
/// degli oggetti. Le chiavi che tornano sono gli id di tutti. `null` se il
/// livello schiaccia il piano.
export function intoLayerOps(model: DocumentModel, units: readonly Unit[], layer: LayerInfo, ids: NewIds): Arranged | null {
  const inverse = invert(layer.matrix);
  if (inverse === null) return null;
  const plan = new Plan(model, ids);
  const moving = units.filter((unit) => !inLayer(unit, layer));
  if (moving.length === 0) return { ops: [], keys: units.map((unit) => unit.key) };
  const target = layerNode(model, layer);
  const parent = plan.idOf(target, "layer");
  for (const unit of moving) {
    const node = nodeOf(model, unit);
    const id = plan.idOf(node);
    const attrs: Record<string, string | null> = {};
    // Da un livello con la stessa trasformazione l'oggetto passa com'è.
    if (!unit.parent.every((v, i) => v === layer.matrix[i])) attrs.transform = transformValue(compose(inverse, unit.matrix));
    Object.assign(attrs, carriedTo(node, target));
    if (Object.keys(attrs).length > 0) plan.ops.push({ op: "set", id, attrs });
    plan.ops.push({ op: "move", target: id, parent, pos: { last: true } });
  }
  // Anche chi resta riceve un id: chi se ne va dal suo livello può cambiare il
  // suo percorso.
  return plan.finish(units.map((unit) => plan.idOf(nodeOf(model, unit))));
}
