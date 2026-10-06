// Il nome di un oggetto (livello Standard, coi «Livelli»): il suo primo
// `title`, che è anche il nome con cui uno screen reader lo dice. Un livello
// ha il suo nome in `fub:layer`, e lo cambia `renameLayerOps`.
//
// - **Un passo solo.** Dare, cambiare o togliere un nome è un `batch`, che si
//   annulla in un colpo.
// - **Il `title` resta lui.** Cambia il testo del primo `title`: i suoi
//   attributi restano, e gli altri `title`, per esempio in altre lingue, non
//   si toccano. Senza nome se ne va lui solo.
// - **Un gruppo o un collegamento** cambiano soltanto il loro `title`, tolto
//   e rimesso fra i figli, dopo la descrizione se c'è. Un `title` estraneo
//   si toglie col suo percorso, e il nuovo è senza attributi; così anche
//   uno con attributi che un'operazione non sa scrivere.
// - **Un'unità** si riscrive col `title` nuovo, al suo posto e col suo id,
//   come «Oggetto in tracciato»: un'unità non ha figli da aggiungere uno per
//   uno. Una con parti o nomi che un'operazione non sa scrivere resta com'è.

import { elementChildren, isSvgElement, pathOf, scopeOf, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import { elemToOut, type Elem } from "../scene/serialize";
import { elemOf, nodeOf, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import { replaceElem } from "./topath";

/// Il nome più lungo, in caratteri: un nome, non una descrizione.
export const NAME_MAX = 200;

/// Un nome come lo scrive chi lo dà: gli spazi raccolti, senza quelli ai
/// bordi, e non oltre [`NAME_MAX`] caratteri.
export function cleanName(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(collapsed);
  return chars.length <= NAME_MAX ? collapsed : chars.slice(0, NAME_MAX).join("").trimEnd();
}

/// Il testo del primo `title` fra gli `elems`, e dove sta; `null` se non ce
/// n'è uno.
function firstTitle(elems: readonly Elem[]): { readonly at: number; readonly elem: Elem } | null {
  const at = elems.findIndex((elem) => elem.tag === "title");
  return at < 0 ? null : { at, elem: elems[at]! };
}

/// Le operazioni che danno all'oggetto `item` il nome `name`, già pulito da
/// [`cleanName`]; un nome vuoto lo toglie. Nessuna operazione se il nome è
/// lo stesso. La chiave che torna è l'id dell'oggetto. `"foreign"` se
/// l'oggetto ha parti che un'operazione non sa scrivere.
export function nameOps(model: DocumentModel, item: { readonly path: readonly number[] }, name: string, ids: NewIds): Arranged | "foreign" {
  const node = nodeOf(model, item);
  return node.kind === "container" ? nameContainer(model, node, name, ids) : nameLeaf(model, node, name, ids);
}

/// Vero se l'oggetto `item` sa cambiare nome: un'unità con parti o nomi che
/// un'operazione non sa scrivere no, qualunque nome riceva.
export function nameable(model: DocumentModel, item: { readonly path: readonly number[] }): boolean {
  const node = nodeOf(model, item);
  if (node.kind === "container") return true;
  const elem = elemOf(node);
  return elem !== null && writable(elem, node.parent!);
}

/// Vero se `elem` si scrive come figlio di `parent`: un'operazione non
/// dichiara namespace, e un prefisso dichiarato sull'elemento stesso non si
/// riscrive.
function writable(elem: Elem, parent: ContainerNode): boolean {
  try {
    elemToOut(elem, scopeOf(parent));
    return true;
  } catch {
    return false;
  }
}

function nameContainer(model: DocumentModel, node: ContainerNode, name: string, ids: NewIds): Arranged {
  const old = elementChildren(node).find((child) => isSvgElement(child, "title"));
  const was = old === undefined ? null : elemOf(old);
  if (old === undefined ? name === "" : was !== null && cleanName(was.text ?? "") === name) return { ops: [], keys: [] };
  const plan = new Plan(model, ids);
  const id = plan.idOf(node);
  // Prima si toglie il vecchio, che può avere un id; poi si mette il nuovo,
  // con i suoi attributi.
  if (old !== undefined) plan.ops.push({ op: "remove", target: old.facts.id ?? { path: pathOf(old), tag: "title" } });
  if (name !== "") {
    const kept: Elem = { tag: "title", attrs: was?.attrs ?? {}, text: name };
    plan.ops.push({ op: "add", parent: id, pos: { first: true }, elem: writable(kept, node) ? kept : { tag: "title", attrs: {}, text: name } });
  }
  return plan.finish([id]);
}

function nameLeaf(model: DocumentModel, node: ElementPart, name: string, ids: NewIds): Arranged | "foreign" {
  const elem = elemOf(node);
  if (elem === null) return "foreign";
  const children = [...(elem.children ?? [])];
  const found = firstTitle(children);
  if (found === null ? name === "" : cleanName(found.elem.text ?? "") === name) return { ops: [], keys: [] };
  if (name === "") children.splice(found!.at, 1);
  else if (found === null) children.unshift({ tag: "title", attrs: {}, text: name });
  else children[found.at] = { ...found.elem, text: name };
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(elem.attrs)) if (key !== "id") attrs[key] = value;
  const next: Elem = children.length === 0 ? { tag: elem.tag, attrs } : { tag: elem.tag, attrs, children };
  const plan = new Plan(model, ids);
  if (!replaceElem(plan, node, next)) return "foreign";
  return plan.finish([plan.idOf(node)]);
}
