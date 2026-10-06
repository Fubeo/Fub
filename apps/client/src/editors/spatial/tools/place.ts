// Spostare nell'albero degli oggetti (livello Standard): uno o più oggetti
// davanti o dietro a un altro, o dentro un livello, un gruppo o un
// collegamento; un livello sopra o sotto un altro. Ogni gesto è un `batch`
// solo, come i comandi di `arrange.ts`, così annulla e ripeti lo disfano
// intero.
//
// - **Spostare, non riscrivere.** Gli elementi vanno con `move`, che li porta
//   com'erano scritti; passa da `set` solo ciò che deve cambiare perché si
//   vedano come prima.
// - **Ciò che si vede resta.** Chi cambia contenitore prende la
//   trasformazione che lo lascia dove si vedeva, e scrive su di sé lo stile
//   che ereditava e che il contenitore nuovo cambierebbe: riempimento,
//   contorno, carattere. Opacità e visibilità sono del contenitore e valgono
//   per ciò che contiene: chi entra in un gruppo trasparente lo diventa, chi
//   ne esce torna com'è, e il giro inverso riporta la stessa cosa.
// - **L'ordine fra loro resta.** Più elementi vanno insieme nel posto
//   scelto, uno dopo l'altro nell'ordine del documento.
// - **Gli id prima di tutto**, come in `arrange.ts`.

import type { IdKind } from "../scene/ids";
import { compose, IDENTITY, invert, type Matrix } from "../scene/matrix";
import { elementChildren, pathOf, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import { ROOT, type Pos } from "../scene/ops";
import { transform as parseTransform } from "../scene/values";
import { SVG_NS } from "../scene/xml";
import { INHERITED, plainAttributes, Plan, type Arranged } from "./arrange";
import { transformValue, type NewIds } from "./edit";

/// Dove va ciò che si sposta, fra i figli del contenitore: subito dopo un
/// figlio nell'ordine del documento, cioè davanti a lui; per primo, dopo
/// titolo, descrizione e carta, cioè dietro a tutti; per ultimo, davanti a
/// tutti.
export type Place = { readonly after: ElementPart } | "first" | "last";

/// I valori di partenza degli attributi ereditati, quelli di un elemento a
/// cui nessuno li scrive: chi esce da un contenitore che non li scriveva per
/// entrare in uno che li scrive li prende così. `font-family` non ne ha uno
/// che si possa scrivere, e resta quello che trova.
export const INITIAL: Readonly<Record<string, string>> = {
  fill: "#000000",
  "fill-opacity": "1",
  stroke: "none",
  "stroke-width": "1",
  "stroke-opacity": "1",
  "stroke-linecap": "butt",
  "stroke-linejoin": "miter",
  "stroke-dasharray": "none",
  "font-size": "16",
  "font-weight": "normal",
  "text-anchor": "start",
};

/// Gli attributi ereditati che contano per `node`: per un testo e per un
/// contenitore tutti, per una forma quelli del colore e del contorno, per
/// un'immagine nessuno.
export function inheritedFor(node: ElementPart): readonly string[] {
  return inheritedBy(node.facts.local, node.kind === "container");
}

/// Gli attributi ereditati che contano per un elemento `local`, contenitore
/// o no.
export function inheritedBy(local: string, container: boolean): readonly string[] {
  if (container || local === "text") return INHERITED;
  if (local === "image") return [];
  return INHERITED.filter((name) => !name.startsWith("font-") && name !== "text-anchor");
}

/// Vero se `node` sta fra i figli di `parent` prima di ciò che va «per
/// primo»: titolo e descrizione, e la carta sotto la radice.
function heading(parent: ContainerNode, node: ElementPart): boolean {
  if (node.facts.uri === SVG_NS && (node.facts.local === "title" || node.facts.local === "desc")) return true;
  return parent.parent === null && node.details?.role === "paper";
}

/// Il genere di id di `node`: un livello ha il suo.
function kindOf(node: ElementPart): IdKind {
  return node.parent?.parent === null && node.details?.role === "layer" ? "layer" : "object";
}

/// La chiave con cui l'editor sceglie `node`: l'id, o `@` e il percorso.
function keyOf(node: ElementPart): string {
  return node.facts.id ?? `@${pathOf(node).join(".")}`;
}

/// Vero se `node` sta dentro uno di `chosen`.
function inside(node: ElementPart, chosen: ReadonlySet<ElementPart>): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (chosen.has(at)) return true;
  return false;
}

/// Prima chi viene prima nel documento.
function documentOrder(a: ElementPart, b: ElementPart): number {
  const pa = pathOf(a);
  const pb = pathOf(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return pa.length - pb.length;
}

function sameMatrix(a: Matrix, b: Matrix): boolean {
  return a.every((v, i) => v === b[i]);
}

/// Le operazioni che portano `moving` fra i figli di `parent`, nel posto
/// `at`, nell'ordine del documento e com'erano a vederli; chi sta dentro un
/// altro che si sposta va con lui. Le chiavi che tornano sono gli id di
/// tutti, nell'ordine di `moving`: anche chi va con un altro riceve il suo,
/// perché il suo percorso cambia. Nessuna operazione se niente cambia di
/// posto; `null` se `parent` è uno di loro o sta dentro uno di loro, o se
/// schiaccia il piano.
export function placeOps(model: DocumentModel, moving: readonly ElementPart[], parent: ContainerNode, at: Place, ids: NewIds): Arranged | null {
  const chosen = new Set(moving);
  const roots = moving.filter((node, i) => moving.indexOf(node) === i && !inside(node, chosen)).sort(documentOrder);
  for (let container: ContainerNode | null = parent; container !== null; container = container.parent) if (chosen.has(container)) return null;
  if (roots.length === 0) return { ops: [], keys: [] };

  // Il posto fra chi resta: dopo un figlio che non si sposta e che
  // un'operazione nomina, o per primo.
  const siblings = elementChildren(parent);
  let anchor: ElementPart | "first" | "last";
  if (typeof at === "string") {
    anchor = at;
  } else {
    let i = siblings.indexOf(at.after);
    if (i < 0) return null;
    while (i >= 0 && (chosen.has(siblings[i]!) || siblings[i]!.details === null)) i--;
    anchor = i < 0 || heading(parent, siblings[i]!) ? "first" : siblings[i]!;
  }

  // Niente da fare se sono già lì, in quell'ordine.
  const rest = siblings.filter((node) => !chosen.has(node));
  let index = rest.length;
  if (anchor === "first") {
    index = 0;
    rest.forEach((node, i) => {
      if (heading(parent, node)) index = i + 1;
    });
  } else if (anchor !== "last") {
    index = rest.indexOf(anchor) + 1;
  }
  const after = [...rest.slice(0, index), ...roots, ...rest.slice(index)];
  if (roots.every((node) => node.parent === parent) && after.every((node, i) => node === siblings[i])) {
    return { ops: [], keys: moving.map(keyOf) };
  }

  const attributes = new Map<ElementPart, Map<string, string>>();
  const attrsOf = (node: ElementPart): Map<string, string> => {
    let attrs = attributes.get(node);
    if (attrs === undefined) attributes.set(node, (attrs = plainAttributes(node)));
    return attrs;
  };
  const matrices = new Map<ContainerNode, Matrix>();
  const matrixOf = (container: ContainerNode): Matrix => {
    if (container.parent === null) return IDENTITY;
    let matrix = matrices.get(container);
    if (matrix === undefined) {
      matrix = compose(matrixOf(container.parent), parseTransform(attrsOf(container).get("transform") ?? "") ?? IDENTITY);
      matrices.set(container, matrix);
    }
    return matrix;
  };
  /// Il valore di `name` che ricevono i figli di `container`: il suo, o
  /// quello di chi lo contiene; `null` se nessuno lo scrive.
  const inherited = (container: ContainerNode, name: string): string | null => {
    for (let node: ContainerNode | null = container; node !== null; node = node.parent) {
      const value = attrsOf(node).get(name);
      if (value !== undefined) return value;
    }
    return null;
  };

  const target = matrixOf(parent);
  const inverse = invert(target);
  /// Ciò che `node` scrive su di sé per vedersi uguale in `parent`; `null`
  /// se `parent` schiaccia il piano.
  const keep = (node: ElementPart): Record<string, string | null> | null => {
    const change: Record<string, string | null> = {};
    const own = attrsOf(node);
    const was = matrixOf(node.parent!);
    if (!sameMatrix(was, target)) {
      if (inverse === null) return null;
      const value = transformValue(compose(inverse, compose(was, parseTransform(own.get("transform") ?? "") ?? IDENTITY)));
      if (value !== (own.get("transform") ?? null)) change.transform = value;
    }
    for (const name of inheritedFor(node)) {
      if (own.has(name)) continue;
      const before = inherited(node.parent!, name);
      if (before === inherited(parent, name)) continue;
      const value = before ?? INITIAL[name];
      if (value !== undefined) change[name] = value;
    }
    return change;
  };

  const plan = new Plan(model, ids);
  const container = parent === model.root ? ROOT : plan.idOf(parent, kindOf(parent));
  const first: Pos = anchor === "first" ? { first: true } : anchor === "last" ? { last: true } : { after: plan.idOf(anchor, kindOf(anchor)) };
  let previous: string | null = null;
  for (const node of roots) {
    const id = plan.idOf(node, kindOf(node));
    if (node.parent !== parent) {
      const change = keep(node);
      if (change === null) return null;
      if (Object.keys(change).length > 0) plan.ops.push({ op: "set", id, attrs: change });
    }
    plan.ops.push({ op: "move", target: id, parent: container, pos: previous === null ? first : { after: previous } });
    previous = id;
  }
  return plan.finish(moving.map((node) => plan.idOf(node, kindOf(node))));
}
