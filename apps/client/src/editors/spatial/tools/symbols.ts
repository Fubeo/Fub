// I simboli nell'editor (Disegni, simboli; formato della scena, simboli):
// leggere i simboli del disegno, crearne uno dalla selezione e scollegare
// un'istanza. Ogni comando diventa un `batch` solo, come quelli di
// `arrange.ts`.
//
// - **Crea simbolo** sposta gli oggetti scelti, com'erano scritti, nel
//   contenuto di un simbolo nuovo della `defs`, e al loro posto, dov'era il
//   più alto, mette un'istanza. L'origine del simbolo è il centro del
//   riquadro che si vede, a numeri interi: l'istanza ci porta il contenuto,
//   e il disegno resta com'era. Gli oggetti di un altro livello vi entrano
//   con la trasformazione che li lascia dov'erano, come in un gruppo.
// - **Gli agganci restano veri.** Un connettore fuori dal simbolo agganciato
//   a un oggetto che vi entra si aggancia all'istanza, se un capo solo vi
//   entra; dentro, un capo agganciato a ciò che resta fuori si stacca, come
//   un'etichetta che resta da una parte senza il suo connettore o la sua
//   forma.
// - **Scollega** mette al posto di ogni istanza un gruppo con una copia del
//   contenuto del simbolo, con id nuovi, la trasformazione, l'opacità e gli
//   effetti dell'istanza, e il suo nome o quello del simbolo. Le risorse
//   private del contenuto si copiano come per un duplicato; i connettori
//   agganciati all'istanza si agganciano al gruppo. Un contenuto con parti
//   estranee non si copia, e non si scollega.
// - **Scambia** dà alle istanze scelte un altro simbolo, al posto e con la
//   trasformazione che hanno; un simbolo che conterrebbe sé stesso non si
//   sceglie. **Rinomina** cambia il `title` del simbolo, come per un
//   oggetto, e due simboli non hanno lo stesso nome.

import { elementChildren, rawOf, titleOf, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { Arranged } from "./arrange";
import { cleanName, NAME_MAX, nameKey } from "./naming";
import { resourcesOf } from "./resources";

/// Un simbolo del disegno: l'id, il nome, il nodo e da dove viene.
export interface DocumentSymbol {
  readonly id: string;
  /// Il primo `title`; vuoto senza.
  readonly name: string;
  readonly node: ContainerNode;
  /// `fub:source`, com'è scritto; `null` senza.
  readonly source: string | null;
}

/// L'origine di un simbolo copiato da una libreria, da `fub:source`.
export interface Origin {
  readonly path: string;
  readonly id: string;
  readonly print: string;
}

/// L'origine scritta in `value`, letta dalla fine; `null` se non ha la
/// forma del formato, e allora non dice niente.
export function readOrigin(value: string | null): Origin | null {
  if (value === null) return null;
  const space = value.lastIndexOf(" ");
  if (space < 0) return null;
  const print = value.slice(space + 1);
  if (!/^[0-9a-f]{16}$/.test(print)) return null;
  const hash = value.lastIndexOf("#", space);
  if (hash <= 0) return null;
  const id = value.slice(hash + 1, space);
  if (id === "" || /[\s#]/.test(id)) return null;
  return { path: value.slice(0, hash), id, print };
}

/// I simboli del disegno `model`, in ordine di documento.
export function documentSymbols(model: DocumentModel): DocumentSymbol[] {
  const out: DocumentSymbol[] = [];
  for (const defs of elementChildren(model.root)) {
    if (defs.kind !== "container" || defs.details?.role !== "defs") continue;
    for (const child of elementChildren(defs)) {
      if (child.kind !== "container" || child.details?.role !== "symbol" || child.facts.id === null) continue;
      out.push({ id: child.facts.id, name: titleOf(child) ?? "", node: child, source: child.details.source ?? null });
    }
  }
  return out;
}

/// Il simbolo di cui `node` è un'istanza; `null` se non lo è.
export function instanceSymbol(model: DocumentModel, node: ElementPart): DocumentSymbol | null {
  if (node.kind !== "leaf" || node.details?.role !== "instance") return null;
  return documentSymbols(model).find((symbol) => symbol.id === node.details!.symbol) ?? null;
}

/// I rimandi scritti in un testo: `url(#…)`, un `href` che è un frammento,
/// lo stile che un oggetto segue.
const TEXT_REFS = /url\(\s*["']?#([^"')\s]+)|\s(?:[\w.-]+:)?href\s*=\s*(["'])#(.*?)\2|\sfub:style\s*=\s*(["'])(.+?)\4/g;

/// Il simbolo `id` e le risorse che usa, anche attraverso altre, ognuno con
/// l'id e il testo letto da `lookup`: prima quelle che nomina lui, poi
/// quelle che nominano loro, ognuna la prima volta che la si incontra. Un
/// rimando che `lookup` non conosce, come un oggetto del contenuto, non
/// conta.
export function symbolClosure(id: string, lookup: (id: string) => string | undefined): Array<[id: string, text: string]> {
  const texts: Array<[string, string]> = [];
  const seen = new Set<string>([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    const text = lookup(queue[i]!);
    if (text === undefined) continue;
    texts.push([queue[i]!, text]);
    for (const match of text.matchAll(TEXT_REFS)) {
      const ref = match[1] ?? match[3] ?? match[5]!;
      if (seen.has(ref)) continue;
      seen.add(ref);
      queue.push(ref);
    }
  }
  return texts;
}

/// Il testo delle risorse e dei simboli del disegno `model`, per id.
export function resourceTexts(model: DocumentModel): (id: string) => string | undefined {
  const symbols = new Map(documentSymbols(model).map((symbol) => [symbol.id, symbol.node]));
  const resources = resourcesOf(model);
  return (id) => {
    const symbol = symbols.get(id);
    return symbol !== undefined ? rawOf(symbol) : resources.get(id)?.raw;
  };
}

/// Il primo nome libero da `base` fra i simboli di `model`, pulito come
/// ogni nome: lui, poi `base 2`, `base 3` e così via. Due nomi uguali senza
/// badare alle maiuscole sono lo stesso.
export function freshSymbolName(model: DocumentModel, base: string): string {
  return freeSymbolName(new Set(documentSymbols(model).map((symbol) => nameKey(symbol.name))), base);
}

/// Il primo nome libero da `base` fuori da `taken`, le chiavi dei nomi presi
/// ([`nameKey`]): come [`freshSymbolName`], per chi conta anche i simboli
/// che stanno arrivando.
export function freeSymbolName(taken: ReadonlySet<string>, base: string): string {
  const clean = cleanName(base);
  if (!taken.has(nameKey(clean))) return clean;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${Array.from(clean).slice(0, NAME_MAX - suffix.length).join("").trimEnd()}${suffix}`;
    if (!taken.has(nameKey(name))) return name;
  }
}

/// Perché «Crea simbolo» non si fa: niente che si veda, o il livello del più
/// alto schiaccia il piano.
export type SymbolRefusal = "empty" | "flat";

/// Un simbolo creato: le operazioni, la selezione dopo, che è l'istanza, e
/// l'id e il nome del simbolo.
export interface SymbolMade extends Arranged {
  readonly id: string;
  readonly name: string;
  readonly instance: string;
}

/// Perché «Scollega» non si fa: il contenuto di un simbolo ha parti che
/// un'operazione non sa copiare.
export type DetachRefusal = "content";
