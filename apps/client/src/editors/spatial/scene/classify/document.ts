// La classificazione della scena, la visita del documento: una pila
// esplicita che costruisce le voci e i blocchi estranei (`../classify.ts`).

import { Context, isContainer, Tally, type Role, type Swatches } from "../analysis";
import { diagnostic, type Diagnostic } from "../diagnostics";
import { NS_NONE, valueOf, type NodeId, type XmlDocument } from "../xml";
import type { Item, Place, Resolve, Tag, Tags } from "./types";
import { firstTitle } from "./attributes";
import { classifyChild, indexResources, originalsOf, repeatOf, type Styles, withOriginals } from "./children";
import { describe, elementItem, followedKind } from "./describe";

/// Un blocco estraneo in costruzione.
export interface Pending {
  start: number;
  end: number;
  elements: [number, number];
}

/// Un contenitore in visita.
export interface Frame {
  readonly node: NodeId;
  /// Dove stanno i suoi figli.
  readonly place: Place;
  readonly path: readonly number[];
  next: number;
  elements: number;
  pending: Pending | null;
  readonly context: Context;
  /// Che cosa è ogni id a cui rimandano i figli: in una ripetizione, con
  /// gli originali.
  readonly resolve: Resolve;
  /// Gli originali dei figli, in una ripetizione.
  readonly originals: ReadonlySet<string> | null;
}

/// Ciò che la classificazione trova.
export interface Classified {
  readonly items: Item[];
  /// S002, S004, S010 e S018.
  readonly diagnostics: Diagnostic[];
  readonly tally: Tally;
}

export function isXmlSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

export class Builder {
  readonly items: Item[] = [];
  readonly diagnostics: Diagnostic[] = [];
  readonly tally: Tally;

  constructor(
    private readonly doc: XmlDocument,
    /// Falso per un documento oltre il limite di elementi: le voci si
    /// contano e si scartano, e restano solo riepilogo e diagnostica.
    private readonly keep: boolean,
    /// Le risorse modificabili del documento.
    private readonly resolve: Resolve,
    /// Il `d` dei tracciati delle risorse, per id.
    paths: ReadonlyMap<string, string>,
    /// I campioni del documento, col loro colore.
    private readonly swatches: Swatches,
    /// Gli stili del documento, col loro tipo.
    private readonly styles: Styles,
  ) {
    this.tally = new Tally(paths);
  }

  /// Allunga il blocco in attesa fino a `id`; `element` è l'indice del nodo
  /// fra i figli elemento, se è un elemento. Un blocco comincia e finisce su
  /// un carattere che non è spazio: gli spazi ai bordi di un testo estraneo
  /// stanno fra due voci, come gli altri.
  extend(pending: Pending | null, id: NodeId, element: number | null, next: number): Pending {
    const node = this.doc.nodes[id]!;
    let start = node.start;
    let end = node.end;
    if (node.kind === "text") {
      const text = this.doc.source.text;
      while (start < end && isXmlSpace(text.charCodeAt(start))) start++;
      while (end > start && isXmlSpace(text.charCodeAt(end - 1))) end--;
    }
    const block = pending ?? { start, end, elements: [element ?? next, element ?? next] };
    block.end = end;
    if (element !== null) block.elements[1] = element + 1;
    return block;
  }

  flush(pending: Pending | null, parentPath: readonly number[] | null): void {
    if (pending === null) return;
    const span = this.doc.source.span(pending.start, pending.end);
    if (this.keep) {
      this.items.push({
        kind: "foreign",
        parentPath: parentPath === null ? null : [...parentPath],
        ...span,
        elements: pending.elements,
        indent: this.doc.source.indent(pending.start),
      });
    }
    this.tally.foreign();
    this.diagnostics.push(diagnostic("S002", span));
  }

  tags(id: NodeId): Tags {
    const element = this.doc.element(id)!;
    const source = this.doc.source;
    return {
      open: source.span(element.start, element.openEnd),
      close: element.closeStart === null ? null : source.span(element.closeStart, element.end),
    };
  }

  elementItem(id: NodeId, tag: Tag, role: Role, path: number[], context: Context): void {
    const doc = this.doc;
    const element = doc.element(id)!;
    const span = doc.source.span(element.start, element.end);
    const described = describe(doc, id, tag, role);
    const title = isContainer(role) ? firstTitle(doc, element) : null;
    const details = title === null ? described.details : { ...described.details, title };
    for (const [code, detail] of described.problems) this.diagnostics.push(diagnostic(code, span, detail));
    // S018: segue uno stile che non c'è, o uno dell'altro tipo.
    const follows = details.follows;
    if (follows !== undefined && this.styles.get(follows) !== followedKind(role)) this.diagnostics.push(diagnostic("S018", span, follows));
    this.tally.element(doc, element, role, context, span, details.stroke ?? null);
    if (!this.keep) return;
    this.items.push(elementItem(details, path, span, doc.source.indent(element.start), isContainer(role) ? this.tags(id) : null));
  }

  /// Visita la radice e i contenitori modificabili, in ordine di documento.
  walk(root: NodeId): void {
    const doc = this.doc;
    const stack: Frame[] = [
      {
        node: root,
        place: "root",
        path: [],
        next: 0,
        elements: 0,
        pending: null,
        context: Context.root(doc.element(root)!, this.swatches),
        resolve: this.resolve,
        originals: null,
      },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = doc.children(frame.node);
      const child = children[frame.next];
      if (child === undefined) {
        stack.pop();
        this.flush(frame.pending, frame.path);
        continue;
      }
      frame.next++;
      const node = doc.nodes[child]!;
      if (node.kind === "text" && node.blank) continue;
      if (node.kind !== "element") {
        frame.pending = this.extend(frame.pending, child, null, frame.elements);
        continue;
      }
      const index = frame.elements++;
      const found = classifyChild(doc, child, frame.place, frame.path.length + 1, frame.resolve);
      if (found === null) {
        frame.pending = this.extend(frame.pending, child, index, frame.elements);
        continue;
      }
      const [tag, role] = found;
      const pending = frame.pending;
      frame.pending = null;
      let context = frame.context.child(node);
      // Un originale ha il suo riquadro, che le copie portano dove stanno.
      const id = valueOf(node, NS_NONE, "id");
      if (frame.originals !== null && role !== "copy" && id !== undefined && frame.originals.has(id)) {
        this.tally.original(frame.context, id);
        context = context.original(id);
      }
      this.flush(pending, frame.path);
      const path = [...frame.path, index];
      this.elementItem(child, tag, role, path, context);
      if (isContainer(role)) {
        const place: Place = role === "defs" ? "defs" : "inside";
        // Il contenuto di un simbolo sta nelle coordinate del simbolo.
        const inner = role === "symbol" ? context.within(id!) : context;
        const originals = role === "group" && repeatOf(node) !== null ? originalsOf(doc, child, path.length + 1, this.resolve) : null;
        const resolve = originals === null ? this.resolve : withOriginals(this.resolve, originals);
        stack.push({ node: child, place, path, next: 0, elements: 0, pending: null, context: inner, resolve, originals });
      }
    }
  }
}

/// Classifica un documento letto per intero. Con `keep` falso le voci non si
/// conservano: un documento oltre il limite di elementi ne avrebbe troppe, e
/// serve solo il suo riepilogo.
export function classifyDocument(doc: XmlDocument, keep: boolean): Classified {
  const resources = indexResources(doc);
  const builder = new Builder(doc, keep, (id) => resources.kinds.get(id) ?? null, resources.paths, resources.swatches, resources.styles);
  let pending: Pending | null = null;
  // Per il documento la radice è l'elemento 0: l'epilogo comincia da 1.
  let next = 0;
  for (const id of doc.top) {
    const node = doc.nodes[id]!;
    if (node.kind === "text") continue;
    if (node.kind === "element") {
      builder.flush(pending, null);
      pending = null;
      if (keep) builder.items.push({ kind: "root", ...doc.source.span(node.start, node.end), tags: builder.tags(id) });
      builder.walk(id);
      next = 1;
    } else {
      pending = builder.extend(pending, id, null, next);
    }
  }
  builder.flush(pending, null);
  return { items: builder.items, diagnostics: builder.diagnostics, tally: builder.tally };
}
