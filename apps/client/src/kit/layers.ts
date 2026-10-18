// I piani aperti del kit: popover e dialoghi, dal più vecchio al più recente.
//
// Due regole stanno fra i piani e non dentro uno, e per questo vivono qui:
// - Esc è del piano in cima, e di lui solo;
// - un gesto dentro un piano non è «fuori» per quello da cui è nato. Un piano
//   nasce da un altro quando la sua origine (l'ancora di un popover, chi aveva
//   il fuoco all'apertura di un dialogo) sta dentro la superficie dell'altro.
//
// A shell ferma la pila è vuota: ogni piano si toglie quando si chiude.
import type { Teardown } from "../ui/lifetime";

export interface Layer {
  /// La superficie del piano.
  readonly root: HTMLElement;
  /// L'ancora, se è un elemento: un gesto su di lei non è «fuori».
  readonly anchor: Element | null;
  /// Il piano da cui questo è nato.
  readonly parent: Layer | null;
  /// Chiude il piano perché si è chiuso quello da cui è nato.
  readonly dismiss: () => void;
}

const stack: Layer[] = [];

/// Mette un piano in cima. `origin` decide da quale piano nasce.
export function openLayer(
  root: HTMLElement,
  origin: Element | null,
  anchor: Element | null,
  dismiss: () => void,
): { layer: Layer; release: Teardown } {
  let parent: Layer | null = null;
  if (origin) {
    for (let index = stack.length - 1; index >= 0 && !parent; index--) {
      if (stack[index].root.contains(origin)) parent = stack[index];
    }
  }
  const layer: Layer = { root, anchor, parent, dismiss };
  stack.push(layer);
  return {
    layer,
    release() {
      // Non `pop`: un piano sotto può chiudersi per conto suo mentre sopra ce
      // n'è un altro.
      const index = stack.lastIndexOf(layer);
      if (index >= 0) stack.splice(index, 1);
    },
  };
}

export function isTopLayer(layer: Layer): boolean {
  return stack[stack.length - 1] === layer;
}

function descends(layer: Layer, ancestor: Layer): boolean {
  for (let each: Layer | null = layer; each; each = each.parent) {
    if (each === ancestor) return true;
  }
  return false;
}

/// Vero se `node` sta nel piano, nella sua ancora o in un piano nato da lui.
export function layerHolds(layer: Layer, node: Node): boolean {
  if (layer.anchor?.contains(node)) return true;
  return stack.some((each) => descends(each, layer) && each.root.contains(node));
}

/// Chiude i piani nati da `layer`, dal più recente.
export function dismissChildren(layer: Layer): void {
  for (const each of [...stack].reverse()) {
    if (each !== layer && descends(each, layer)) each.dismiss();
  }
}

/// Quanti piani sono aperti: a riposo è zero.
export function openLayers(): number {
  return stack.length;
}
