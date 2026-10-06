// Il documento su cui lavora il motore delle operazioni: l'albero di
// `model.ts`, l'indice degli id, il conteggio degli elementi e il registro
// delle modifiche.
//
// Ogni modifica all'albero passa da qui e si registra. Il registro serve a
// due cose: un `batch` rifiutato a metà torna indietro senza lasciare
// traccia, e un undo che arriva sulla stessa scena lasciata dall'operazione
// rimette i nodi di prima, gli stessi oggetti, byte per byte.

import type { Details } from "./classify";
import { elementsIn, type ContainerNode, type DocumentModel, type ElementFacts, type ElementPart, type Part } from "./model";
import type { Status } from "./read";

/// Il tag di un contenitore con ciò che se ne ricava.
export interface HeadState {
  readonly head: string;
  readonly tail: string | null;
  readonly facts: ElementFacts;
  readonly details: Details | null;
  readonly declarations: ReadonlyArray<readonly [string | null, string]>;
}

/// Una modifica registrata.
export type Entry =
  | {
    readonly kind: "splice";
    readonly owner: ContainerNode;
    readonly index: number;
    readonly removed: readonly Part[];
    readonly inserted: readonly Part[];
  }
  | { readonly kind: "head"; readonly node: ContainerNode; readonly before: HeadState; readonly after: HeadState }
  | { readonly kind: "status"; readonly before: Status; readonly after: Status };

/// Quanti pezzi si passano come argomenti a `splice`, al più: un incolla
/// grande ne porta più di quanti una chiamata ne accetta.
const SPREAD = 4_096;

/// Sostituisce `count` pezzi di `parts` da `index` con `inserted`.
function replaceRange(parts: Part[], index: number, count: number, inserted: readonly Part[]): void {
  if (inserted.length <= SPREAD) {
    parts.splice(index, count, ...inserted);
    return;
  }
  const tail = parts.splice(index + count);
  parts.length = index;
  for (const part of inserted) parts.push(part);
  for (const part of tail) parts.push(part);
}

/// Lo stato del tag di `node`.
export function headState(node: ContainerNode): HeadState {
  return { head: node.head, tail: node.tail, facts: node.facts, details: node.details, declarations: node.declarations };
}

export class Tree {
  /// Ogni id del documento e l'elemento che lo porta, oppure l'unità che lo
  /// contiene se l'id è di un elemento dentro un'unità.
  private readonly ids = new Map<string, ElementPart>();
  private log: Entry[] = [];

  constructor(
    readonly model: DocumentModel,
    public status: Status,
    /// Gli elementi del documento, radice compresa.
    public elements: number,
  ) {
    this.index(model.root, true);
  }

  /// L'elemento indirizzabile con `id`: quello che ha proprio quell'id.
  element(id: string): ElementPart | null {
    const node = this.ids.get(id);
    return node !== undefined && node.facts.id === id ? node : null;
  }

  /// L'elemento che porta `id`, o l'unità che lo contiene.
  holder(id: string): ElementPart | null {
    return this.ids.get(id) ?? null;
  }

  /// Vero se `id` è già usato, anche dentro un'unità.
  has(id: string): boolean {
    return this.ids.has(id);
  }

  private index(node: ElementPart, add: boolean): void {
    if (node.kind === "leaf") {
      for (const id of node.ids) this.indexId(id, node, add);
      return;
    }
    if (node.facts.id !== null) this.indexId(node.facts.id, node, add);
    for (const part of node.parts) if (typeof part !== "string" && part.kind !== "other") this.index(part, add);
  }

  private indexId(id: string, node: ElementPart, add: boolean): void {
    if (!add) {
      this.ids.delete(id);
      return;
    }
    // Il motore controlla l'unicità prima di toccare l'albero: un doppione
    // qui è un errore del motore, e corromperebbe l'indice.
    if (this.ids.has(id)) throw new Error(`id già nell'indice: ${id}`);
    this.ids.set(id, node);
  }

  /// Sostituisce `count` pezzi di `owner` da `index` con `inserted`, e
  /// restituisce quelli tolti. Chi chiama tiene i pezzi in ordine: niente
  /// stringhe vuote, niente due stringhe vicine.
  splice(owner: ContainerNode, index: number, count: number, inserted: readonly Part[]): Part[] {
    const removed = owner.parts.slice(index, index + count);
    for (const part of removed) {
      if (typeof part === "string" || part.kind === "other") continue;
      this.index(part, false);
      this.elements -= elementsIn(part);
    }
    for (const part of inserted) {
      if (typeof part === "string") continue;
      part.parent = owner;
      if (part.kind === "other") continue;
      this.index(part, true);
      this.elements += elementsIn(part);
    }
    replaceRange(owner.parts, index, count, inserted);
    this.log.push({ kind: "splice", owner, index, removed, inserted: [...inserted] });
    return removed;
  }

  /// Cambia il tag di un contenitore.
  setHead(node: ContainerNode, state: HeadState): void {
    const before = headState(node);
    if (before.facts.id !== null && this.ids.get(before.facts.id) === node) this.ids.delete(before.facts.id);
    node.head = state.head;
    node.tail = state.tail;
    node.facts = state.facts;
    node.details = state.details;
    node.declarations = state.declarations;
    if (state.facts.id !== null) this.indexId(state.facts.id, node, true);
    this.log.push({ kind: "head", node, before, after: state });
  }

  setStatus(status: Status): void {
    this.log.push({ kind: "status", before: this.status, after: status });
    this.status = status;
  }

  /// Il punto del registro da cui un'operazione comincia.
  mark(): number {
    return this.log.length;
  }

  /// Toglie dal registro le modifiche dopo `mark` e le restituisce.
  take(mark: number): Entry[] {
    return this.log.splice(mark);
  }

  /// Disfa le modifiche dopo `mark`, senza registrarle.
  rollback(mark: number): void {
    const entries = this.take(mark);
    this.undo(entries);
    this.log.length = mark;
  }

  /// Disfa `entries`, dall'ultima alla prima, registrando ciò che fa: è
  /// l'undo esatto, e il suo registro è il redo.
  undo(entries: readonly Entry[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      switch (entry.kind) {
        case "splice": {
          const current = entry.owner.parts.slice(entry.index, entry.index + entry.inserted.length);
          if (current.length !== entry.inserted.length || current.some((part, k) => part !== entry.inserted[k])) {
            throw new Error("il registro non corrisponde all'albero");
          }
          this.splice(entry.owner, entry.index, entry.inserted.length, entry.removed);
          break;
        }
        case "head":
          this.setHead(entry.node, entry.before);
          break;
        case "status":
          this.setStatus(entry.before);
          break;
      }
    }
  }
}
