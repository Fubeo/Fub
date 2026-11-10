// Le operazioni del motore, una per tipo: add, remove, move, set, text,
// ident, page, meta, anchor e adopt, con le loro inverse (vedi `../engine.ts`).

import { formatNumber } from "../../number";
import { pageId } from "../ids";
import { positive } from "../annotations";
import {
  buildSequence,
  declarationsOf,
  elementChildren,
  idsIn,
  indentOf,
  originalsIn,
  parseFragment,
  parseSequence,
  placeOf,
  rawOf,
  scopeOf,
  tagName,
  type ContainerNode,
  type ElementPart,
  type Part,
  type Sequence,
} from "../model";
import { MAX_NESTING, ROOT, type MetaOp, type Op, type AnchorPrevious, type PagePrevious, type TextLine } from "../ops";
import { parseGuides, parseUnits } from "../rulers";
import {
  attributeName,
  attributesOf,
  canonicalOrder,
  canonicalRuns,
  elemToOut,
  elementToOut,
  escapeAttribute,
  escapeText,
  isXmlText,
  lineContent,
  readRuns,
  writeElement,
  type OutAttr,
  type OutElement,
} from "../serialize";
import { length as svgLength, number as svgNumber } from "../values";
import {
  FUB_NS,
  isSvg,
  NS_FUB,
  NS_NONE,
  NS_SVG,
  SVG_NS,
  valueOf,
  XMLNS_URI,
  type Attr,
  type ElementNode,
  type NodeId,
} from "../xml";
import {
  attributeSpan,
  type Change,
  changed,
  checkNewId,
  type Destination,
  elemGuard,
  expandedNames,
  isBlank,
  isMeta,
  isPagePaper,
  isPath,
  isRecord,
  reindent,
  reject,
  type Reread,
  roleOf,
  sameScope,
  sheetOf,
  TEXT_HOLDERS,
  withPart,
} from "./support";

import { SceneEngineBase } from "./base";

/// Le operazioni del motore sullo stato di `SceneEngineBase`. Le chiama
/// `SceneEngine`, che le smista.
export abstract class SceneOps extends SceneEngineBase {
  // -------------------------------------------------------------------------
  // add, remove e le loro inverse.
  // -------------------------------------------------------------------------

  protected add(op: Record<string, unknown>): Op {
    const parent = this.container(op.parent);
    if (this.lockedInside(parent)) reject("locked", "il genitore è bloccato o sta in un contenitore bloccato");
    if (op.raw !== undefined) {
      if (op.elem !== undefined) reject("invalid-elem", "un add porta elem oppure raw, non tutti e due");
      return this.addRaw(parent, op.pos, op.raw);
    }
    const root = parent === this.t.model.root;
    const scope = scopeOf(parent);
    const elem = this.prepare(op.elem, scope, root, parent.details?.role === "defs");
    if (root && (elem.tag === "title" || elem.tag === "desc")) {
      reject("invalid-elem", "titolo e descrizione della radice cambiano con meta");
    }
    const out = elemGuard(() => elemToOut(elem, scope));
    const id = elem.attrs.id;
    if (id !== undefined && this.t.has(id)) {
      // Un `add` ripetuto dalla rete è un doppione, non un errore (§8).
      const existing = this.t.element(id);
      if (existing !== null && existing.details !== null && this.canonical(existing) === writeElement(out, "")) {
        this.duplicate = true;
        return { op: "batch", ops: [] };
      }
      reject("duplicate-id", `id già usato: ${id}`);
    }
    const to = this.destination(parent, op.pos, elem.tag === "defs");
    const node = this.build(this.eolOf(writeElement(out, this.indentFor(to))), parent);
    if (node === null) reject("invalid-elem", "l'elemento scritto non si legge");
    const problem = this.problem(node);
    if (problem !== null) reject("invalid-elem", problem);
    this.checkNesting(node, parent);
    this.checkResources([node], true);
    this.place(to, [node]);
    this.touch(node);
    this.sheet(node);
    return { op: "remove", target: this.targetOf(node) };
  }

  /// `add` con `raw`: uno o più elementi fratelli scritti così come sono,
  /// coi ritorni a capo del documento (§2). Quelli che il formato ammette
  /// passano dagli stessi controlli di `elem`, e il contorno dei loro tratti
  /// si ricalcola; gli estranei restano come sono.
  private addRaw(parent: ContainerNode, pos: unknown, raw: unknown): Op {
    if (typeof raw !== "string") reject("invalid-elem", "raw non è un testo");
    const scope = scopeOf(parent);
    let text = this.eolOf(raw.replace(/\r\n?/g, "\n"));
    let sequence = parseSequence(text, scope);
    if (sequence === null) reject("invalid-elem", "raw non è una sequenza di elementi ben formata");
    let parts = buildSequence(sequence, parent, this.resolve);
    const edits = this.checkSequence(sequence, parts, parent);
    if (edits.length > 0) {
      let rewritten = "";
      let at = 0;
      for (const [from, to, value] of edits) {
        rewritten += text.slice(at, from) + value;
        at = to;
      }
      text = rewritten + text.slice(at);
      sequence = parseSequence(text, scope);
      if (sequence === null) reject("invalid-elem", "il contorno riscritto non si legge");
      parts = buildSequence(sequence, parent, this.resolve);
    }
    const nodes = parts.filter((part): part is ElementPart => typeof part !== "string" && part.kind !== "other");
    for (const node of nodes) {
      const problem = this.rawProblem(node);
      if (problem !== null) reject("invalid-elem", problem);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      for (const id of idsIn(node)) {
        if (seen.has(id)) reject("duplicate-id", `id ripetuto: ${id}`);
        seen.add(id);
        ids.push(id);
      }
    }
    // Un `add` ripetuto dalla rete è un doppione, non un errore (§8).
    const same = (node: ElementPart): boolean => {
      const existing = node.facts.id === null ? null : this.t.element(node.facts.id);
      return existing !== null && rawOf(existing) === rawOf(node);
    };
    if (nodes.every(same)) {
      this.duplicate = true;
      return { op: "batch", ops: [] };
    }
    const taken = ids.find((id) => this.t.has(id));
    if (taken !== undefined) reject("duplicate-id", `id già usato: ${taken}`);
    this.checkResources(nodes, true);
    const to = this.destination(parent, pos, nodes.every((node) => roleOf(node) === "defs"));
    for (const node of nodes) this.checkNesting(node, parent);
    this.place(to, parts);
    for (const node of nodes) {
      this.touch(node);
      this.sheet(node);
    }
    // Dall'ultimo al primo: togliere un elemento non sposta i percorsi di
    // quelli che lo precedono.
    const removes = nodes.map((node): Op => ({ op: "remove", target: this.targetOf(node) })).reverse();
    return removes.length === 1 ? removes[0]! : { op: "batch", ops: removes };
  }

  /// I controlli di `elem` sugli elementi modificabili di `sequence`, letta
  /// come `parts` sotto `parent`: valori nei limiti, id nella forma degli
  /// id nuovi, niente carta, livelli solo sotto la radice, titolo e
  /// descrizione della radice solo con `meta`. Restituisce, in ordine e
  /// negli indici di `raw`, le modifiche che portano il `d` di ogni tratto
  /// al contorno ricalcolato (§4).
  private checkSequence(sequence: Sequence, parts: readonly Part[], parent: ContainerNode): Array<[number, number, string]> {
    const { doc, offset } = sequence;
    const underRoot = parent === this.t.model.root;
    const underDefs = parent.details?.role === "defs";
    const edits: Array<[number, number, string]> = [];
    /// `inDefs`: l'elemento è figlio di una `defs` della radice.
    const check = (element: ElementNode, top: boolean, inResource: boolean, inDefs: boolean): void => {
      const tag = element.local;
      for (const attr of element.attrs) {
        if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
        this.checkValue(tag, doc.namespaces[attr.ns]!, attr.local, attr.value);
      }
      const sheet = sheetOf(tag, valueOf(element, NS_FUB, "role"), valueOf(element, NS_FUB, "board"), top && underRoot);
      const layer = tag === "g" && valueOf(element, NS_FUB, "layer") !== undefined;
      if (layer && !(top && underRoot)) reject("invalid-elem", "un livello sta solo sotto la radice");
      // Il gruppo di una pagina annotata ha l'id dal numero.
      const page = tag === "g" && top && underRoot ? positive(valueOf(element, NS_FUB, "page")) : null;
      checkNewId(tag, valueOf(element, NS_NONE, "id"), layer, inResource, inDefs, valueOf(element, NS_FUB, "role"), sheet, page);
      const tool = valueOf(element, NS_FUB, "tool");
      if (tag !== "path" || (tool !== "pen" && tool !== "highlighter")) return;
      const d = this.stroke(valueOf(element, NS_FUB, "ink"), valueOf(element, NS_FUB, "brush"));
      if (d === null) return;
      const written = element.attrs.find((attr) => attr.ns === NS_NONE && attr.local === "d");
      if (written === undefined) {
        const at = element.openEnd - (element.closeStart === null ? 2 : 1) - offset;
        edits.push([at, at, ` d="${escapeAttribute(d)}"`]);
      } else if (written.value !== d) {
        edits.push([written.raw[0] - offset, written.raw[1] - offset, escapeAttribute(d)]);
      }
    };
    /// Un elemento modificabile con quelli che contiene.
    const visit = (id: NodeId, node: ElementPart, top: boolean, inDefs: boolean): void => {
      if (node.details === null) return;
      const element = doc.element(id)!;
      check(element, top, false, inDefs);
      const inner = element.children.filter((child) => doc.element(child) !== null);
      if (node.kind === "container") {
        const children = elementChildren(node);
        inner.forEach((child, i) => visit(child, children[i]!, false, roleOf(node) === "defs"));
        return;
      }
      // Ciò che sta dentro una risorsa ha l'id facoltativo.
      const inResource = roleOf(node) === "resource";
      const stack = inner.reverse();
      while (stack.length > 0) {
        const child = doc.element(stack.pop()!)!;
        check(child, false, inResource, false);
        for (let i = child.children.length - 1; i >= 0; i--) if (doc.element(child.children[i]!) !== null) stack.push(child.children[i]!);
      }
    };
    const nodes = parts.filter((part): part is ElementPart => typeof part !== "string" && part.kind !== "other");
    const top = doc.children(sequence.id).filter((child) => doc.element(child) !== null);
    top.forEach((child, i) => {
      const element = doc.element(child)!;
      if (underRoot && element.ns === NS_SVG && (element.local === "title" || element.local === "desc")) {
        reject("invalid-elem", "titolo e descrizione della radice cambiano con meta");
      }
      visit(child, nodes[i]!, true, underDefs);
    });
    return edits;
  }

  /// Il primo problema di un elemento letto da `raw`: un tratto che non si
  /// legge (S004). Le parti estranee non ne hanno.
  private rawProblem(node: ElementPart): string | null {
    if (node.details === null) return null;
    if (node.kind === "leaf") {
      const s004 = node.problems.find(([code]) => code === "S004");
      return s004 === undefined ? null : s004[1];
    }
    for (const part of node.parts) {
      if (typeof part === "string" || part.kind === "other") continue;
      const inner = this.rawProblem(part);
      if (inner !== null) return inner;
    }
    return null;
  }

  /// La forma canonica di un elemento del documento, per confrontarla.
  private canonical(node: ElementPart): string {
    const fragment = parseFragment(rawOf(node), scopeOf(node.parent!));
    return fragment === null ? "" : writeElement(elementToOut(fragment.doc, fragment.id), "");
  }

  protected remove(op: Record<string, unknown>): Op {
    const node = this.target(op.target);
    this.guard(node, false);
    // Chi usa una risorsa diventerebbe estraneo (§2).
    const used = this.usedOutside(node);
    if (used !== null) reject("in-use", `qualcosa fuori da ciò che si toglie usa ${used}`);
    this.touch(node);
    this.sheet(node);
    const raw = rawOf(node);
    const { anchor, gap } = this.detach(node);
    return { op: "add", slot: this.slotOf(anchor), gap, raw };
  }

  /// L'inversa di `remove`: rimette gli spazi e l'elemento così come erano.
  protected restore(op: Record<string, unknown>): Op {
    if (typeof op.raw !== "string" || typeof op.gap !== "string" || !isBlank(op.gap)) reject("invalid-elem", "ripristino non valido");
    const anchor = this.anchorOf(op.slot);
    if (this.lockedInside(anchor.owner)) reject("locked", "il genitore è bloccato o sta in un contenitore bloccato");
    const node = this.build(op.raw, anchor.owner);
    if (node === null) reject("invalid-elem", "l'elemento da rimettere non si legge");
    const taken = idsIn(node).find((id) => this.t.has(id));
    if (taken !== undefined) reject("duplicate-id", `id già usato: ${taken}`);
    this.checkResources([node], false);
    this.insertAt(this.pointOf(anchor), op.gap, [node]);
    this.touch(node);
    this.sheet(node);
    return { op: "remove", target: this.targetOf(node) };
  }

  // -------------------------------------------------------------------------
  // move e la sua inversa.
  // -------------------------------------------------------------------------

  protected move(op: Record<string, unknown>): Op {
    const node = this.target(op.target);
    this.guard(node, false);
    const parent = this.container(op.parent);
    if (this.lockedInside(parent)) reject("locked", "il genitore è bloccato o sta in un contenitore bloccato");
    if (this.within(parent, node)) reject("cycle", "un elemento non va dentro sé stesso");
    const root = parent === this.t.model.root;
    if (roleOf(node) === "layer" && !root) reject("invalid-elem", "un livello sta solo sotto la radice");
    if (isMeta(node) && (root || node.parent === this.t.model.root)) {
      reject("invalid-elem", "titolo e descrizione della radice cambiano con meta");
    }
    if (isRecord(op.pos) && op.pos.after !== undefined && op.pos.after === node.facts.id) {
      reject("missing-anchor", "l'elemento di riferimento è quello che si sposta");
    }
    this.checkNesting(node, parent);
    // Il punto d'arrivo si cerca dopo aver tolto l'elemento: `last` e
    // `first` non contano l'elemento stesso.
    return this.relocate(node, () => this.destination(parent, op.pos, roleOf(node) === "defs"));
  }

  /// L'inversa di `move`: riporta l'elemento al punto da cui è partito.
  protected moveBack(op: Record<string, unknown>): Op {
    if (typeof op.gap !== "string" || !isBlank(op.gap)) reject("invalid-elem", "ritorno non valido");
    const gap = op.gap;
    const node = this.target(op.target);
    this.guard(node, false);
    // I riferimenti del punto valgono sulla scena con l'elemento al suo
    // posto: si risolvono prima di toglierlo.
    const anchor = this.anchorOf(op.slot);
    if (this.lockedInside(anchor.owner)) reject("locked", "il genitore è bloccato o sta in un contenitore bloccato");
    if (this.within(anchor.owner, node)) reject("cycle", "un elemento non va dentro sé stesso");
    if (anchor.after === node) reject("missing-anchor", "l'elemento di riferimento è quello che si sposta");
    return this.relocate(node, () => ({ kind: "point", point: this.pointOf(anchor), gap }));
  }

  /// Sposta `node`: lo toglie, ne porta il rientro su quello del punto
  /// d'arrivo, lo rilegge lì e lo inserisce. Ruolo e nomi non cambiano.
  private relocate(node: ElementPart, destination: () => Destination): Op {
    const model = this.t.model;
    const oldParent = node.parent!;
    const oldScope = scopeOf(oldParent);
    const oldIndent = indentOf(model, node);
    const raw = rawOf(node);
    this.touch(node);
    this.sheet(node);
    const { anchor, gap } = this.detach(node);
    const to = destination();
    const owner = to.kind === "point" ? to.point.owner : to.parent;
    const moved = reindent(raw, oldScope, placeOf(oldParent), oldParent.depth + 1, oldIndent, this.indentFor(to), this.resolve, originalsIn(oldParent));
    const built = this.build(moved, owner);
    if (built === null) reject("invalid-elem", "lo spostamento lascerebbe un prefisso non dichiarato");
    const newScope = scopeOf(owner);
    if (!sameScope(oldScope, newScope)) {
      const before = parseFragment(raw, oldScope)!;
      const after = parseFragment(moved, newScope)!;
      if (expandedNames(before.doc, before.id) !== expandedNames(after.doc, after.id)) {
        reject("invalid-elem", "lo spostamento cambierebbe i namespace dell'elemento");
      }
    }
    if (roleOf(built) !== roleOf(node)) reject("invalid-elem", "lo spostamento cambierebbe il ruolo dell'elemento");
    this.place(to, [built]);
    return { op: "move", target: this.targetOf(built), slot: this.slotOf(anchor), gap };
  }

  // -------------------------------------------------------------------------
  // set, text e ident.
  // -------------------------------------------------------------------------

  protected set(op: Record<string, unknown>): Op {
    if (typeof op.id !== "string" || !isRecord(op.attrs)) reject("invalid-elem", "set non valido");
    if (op.id === ROOT) {
      if (op.part !== undefined) reject("invalid-elem", "part vale soltanto su una risorsa");
      return this.setRoot(op.attrs);
    }
    const node = this.target(op.id);
    this.guard(node, true, true);
    if (op.part !== undefined) return this.setPart(node, op.id, op.part, op.attrs);
    this.sheet(node);
    const read = this.reread(node);
    const { previous, edit, paper } = this.planSet(node, op.attrs, read);

    if (node.kind === "container") {
      // Si riscrive solo il tag, perché i figli non cambiano; un `<g/>` si
      // riscrive per intero, in forma aperta (§6).
      if (node.tail === null && isSvg(read.element, "g")) {
        const indent = indentOf(this.t.model, node);
        this.rewriteHead(node, edit, false);
        this.t.splice(node, 0, node.parts.length, [this.eolOf(`\n${indent}`)]);
      } else {
        this.rewriteHead(node, edit, node.tail === null);
      }
    } else {
      const built = this.rewriteLeaf(node, (out, again) => ({
        ...out,
        attrs: canonicalOrder(edit(attributesOf(again.fragment.doc, again.element))),
      }), read);
      this.checkRewritten(built, paper);
    }
    // Un gruppo cambia anche come si vedono i suoi figli.
    this.touch(node);
    return { op: "set", id: op.id, attrs: previous };
  }

  /// Ciò che un `set` su `node` chiede e dà, controllato: i valori di prima
  /// delle chiavi che cambiano (l'inversa), come si riscrivono gli attributi
  /// e se `node` è una carta. `read` è `node` riletto da solo. Non cambia
  /// niente.
  protected planSet(
    node: ElementPart,
    attrs: Record<string, unknown>,
    read: Reread,
  ): { readonly previous: Record<string, string | null>; readonly edit: (attrs: OutAttr[]) => OutAttr[]; readonly paper: boolean } {
    const { fragment, element, scope } = read;
    const doc = fragment.doc;
    const changes = new Map<string, Change>();
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== null && typeof value !== "string") reject("invalid-elem", `valore non valido per ${key}`);
      const name = elemGuard(() => attributeName(key, scope));
      if (name.uri === "" && name.local === "id") reject("invalid-elem", "l'id cambia solo con ident");
      if (value !== null) this.checkValue(element.local, name.uri, name.local, value);
      const expanded = `${name.uri} ${name.local}`;
      if (changes.has(expanded)) reject("invalid-elem", `attributo ripetuto: ${key}`);
      changes.set(expanded, { key, ...name, value });
    }
    const written = (uri: string, local: string): Attr | undefined =>
      element.attrs.find((a) => doc.namespaces[a.ns] === uri && a.local === local);
    const current = (uri: string, local: string): string | undefined => {
      const change = changes.get(`${uri} ${local}`);
      return change !== undefined ? (change.value ?? undefined) : written(uri, local)?.value;
    };
    // La carta della pagina diventa quella di una tavola con `fub:board` e
    // nient'altro; quella di una tavola cambia in geometria e tavola
    // (formato della scena, tavole).
    const paper = roleOf(node) === "paper";
    if (paper) {
      const allowed = isPagePaper(node) ? [`${FUB_NS} board`] : [" x", " y", " width", " height", `${FUB_NS} board`];
      const outside = [...changes.keys()].find((key) => !allowed.includes(key));
      if (outside !== undefined) reject("locked", `la carta cambia solo con page, o in geometria e tavola: ${changes.get(outside)!.key}`);
      if (isPagePaper(node) && changes.get(`${FUB_NS} board`)?.value === null) reject("locked", "la carta della pagina cambia solo con page");
    } else if (current(FUB_NS, "role") === "paper") {
      reject("invalid-elem", "una carta nasce con add");
    }
    if (isSvg(element, "g") && current(FUB_NS, "layer") !== undefined && node.parent !== this.t.model.root) {
      reject("invalid-elem", "un livello sta solo sotto la radice");
    }
    // Un tratto si ridisegna quando cambiano inchiostro, pennello o
    // strumento, e il suo `d` non si scrive a mano (§4).
    const tool = current(FUB_NS, "tool");
    const touchesStroke = [`${FUB_NS} ink`, `${FUB_NS} brush`, `${FUB_NS} tool`, " d"].some((key) => changes.has(key));
    if (isSvg(element, "path") && (tool === "pen" || tool === "highlighter") && touchesStroke) {
      const d = this.stroke(current(FUB_NS, "ink"), current(FUB_NS, "brush"));
      if (d === null) reject("invalid-elem", "un tratto con canali sconosciuti non si ridisegna (S010)");
      changes.set(" d", { key: changes.get(" d")?.key ?? "d", uri: "", local: "d", name: "d", value: d });
    }

    // L'inversa: i valori di prima delle chiavi che cambiano.
    const previous: Record<string, string | null> = {};
    for (const change of changes.values()) previous[change.key] = written(change.uri, change.local)?.value ?? null;
    const edit = changed(changes);
    return { previous, edit, paper };
  }

  /// Un elemento appena riscritto da un `set` deve restare modificabile, e
  /// una carta resta carta.
  protected checkRewritten(built: ElementPart, paper: boolean): void {
    const problem = this.problem(built);
    if (problem !== null) reject("invalid-elem", problem);
    if ((roleOf(built) === "paper") !== paper) reject("invalid-elem", "una carta nasce con add");
  }

  /// `set` su una parte della risorsa `node`, come il punto di una
  /// sfumatura: `part` sono gli indici dei figli elemento dalla risorsa in
  /// giù. La risorsa si riscrive intera in forma canonica, come con un `set`
  /// suo, e deve restare modificabile (§2).
  private setPart(node: ElementPart, id: string, part: unknown, attrs: Record<string, unknown>): Op {
    if (roleOf(node) !== "resource") reject("invalid-elem", "part vale soltanto su una risorsa");
    if (!Array.isArray(part) || part.length === 0 || part.length > MAX_NESTING || !part.every((i) => Number.isSafeInteger(i) && i >= 0)) {
      reject("invalid-elem", "part non valido");
    }
    const path = part as number[];
    const read = this.reread(node);
    const doc = read.fragment.doc;
    let element = read.element;
    let scope = read.scope;
    for (const index of path) {
      // Il contenuto di un titolo o di una riga è testo, non parti.
      const inner = TEXT_HOLDERS.some((tag) => isSvg(element, tag)) ? [] : element.children.filter((child) => doc.element(child) !== null);
      const child = inner[index];
      if (child === undefined) reject("missing-target", `nessuna parte ${JSON.stringify(path)} in ${id}`);
      element = doc.element(child)!;
      const declarations = declarationsOf(element);
      if (declarations.length > 0) scope = scope.declare(declarations);
    }
    const changes = new Map<string, Change>();
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== null && typeof value !== "string") reject("invalid-elem", `valore non valido per ${key}`);
      const name = elemGuard(() => attributeName(key, scope));
      if (name.uri === "" && name.local === "id") reject("invalid-elem", "l'id di una parte non cambia");
      if (value !== null) this.checkValue(element.local, name.uri, name.local, value);
      const expanded = `${name.uri} ${name.local}`;
      if (changes.has(expanded)) reject("invalid-elem", `attributo ripetuto: ${key}`);
      changes.set(expanded, { key, ...name, value });
    }
    const target = element;
    const previous: Record<string, string | null> = {};
    for (const change of changes.values()) {
      previous[change.key] = target.attrs.find((a) => doc.namespaces[a.ns] === change.uri && a.local === change.local)?.value ?? null;
    }
    const edit = changed(changes);
    const built = this.rewriteLeaf(node, (out) => withPart(out, path, (inner) => ({ ...inner, attrs: canonicalOrder(edit(attributesOf(doc, target))) })));
    const problem = this.problem(built);
    if (problem !== null) reject("invalid-elem", problem);
    this.touch(node);
    return { op: "set", id, part: [...path], attrs: previous };
  }

  /// `set` sulla radice: soltanto l'unità e le guide del documento, coi
  /// valori nella loro grammatica (formato della scena, unità e guide). Il
  /// resto della radice cambia con `page` e `adopt`. Nessun elemento cambia
  /// aspetto, e nessun id è toccato.
  private setRoot(attrs: Record<string, unknown>): Op {
    const root = this.t.model.root;
    const { fragment, element, scope } = this.reread(root);
    const changes = new Map<string, Change>();
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== null && typeof value !== "string") reject("invalid-elem", `valore non valido per ${key}`);
      const name = elemGuard(() => attributeName(key, scope));
      if (name.uri !== FUB_NS || (name.local !== "units" && name.local !== "guides")) {
        reject("invalid-elem", `sulla radice set cambia soltanto fub:units e fub:guides: ${key}`);
      }
      if (value !== null) {
        this.checkValue("svg", name.uri, name.local, value);
        if ((name.local === "units" ? parseUnits(value) : parseGuides(value)) === null) {
          reject("invalid-elem", `${key} fuori grammatica: ${JSON.stringify(value)}`);
        }
      }
      const expanded = `${name.uri} ${name.local}`;
      if (changes.has(expanded)) reject("invalid-elem", `attributo ripetuto: ${key}`);
      changes.set(expanded, { key, ...name, value });
    }
    const previous: Record<string, string | null> = {};
    for (const change of changes.values()) {
      previous[change.key] = element.attrs.find((a) => fragment.doc.namespaces[a.ns] === FUB_NS && a.local === change.local)?.value ?? null;
    }
    this.rewriteHead(root, changed(changes), root.tail === null);
    return { op: "set", id: ROOT, attrs: previous };
  }

  protected text_(op: Record<string, unknown>): Op {
    if (typeof op.id !== "string" || !Array.isArray(op.lines)) reject("invalid-elem", "text non valido");
    // Una riga è testo, o le sue parti: quelle senza niente da dire si
    // tolgono, e una riga che resta senza pezzi è testo.
    const lines: TextLine[] = [];
    for (const line of op.lines as unknown[]) {
      if (typeof line === "string") {
        if (!isXmlText(line) || /[\r\n]/.test(line)) reject("invalid-elem", "riga non valida");
        lines.push(line);
        continue;
      }
      const runs = elemGuard(() => canonicalRuns(line));
      lines.push(runs.every((run) => typeof run === "string") ? runs.join("") : runs);
    }
    // Come ogni riga continua il paragrafo, se l'operazione lo dice
    // (formato della scena, testo).
    let joins: Array<string | null> | null = null;
    if (op.joins !== undefined) {
      if (!Array.isArray(op.joins) || op.joins.length !== lines.length) reject("invalid-elem", "joins non ha una voce per riga");
      joins = (op.joins as unknown[]).map((join) => {
        if (join !== null && typeof join !== "string") reject("invalid-elem", "una voce di joins non è un testo");
        if (join !== null) this.checkValue("tspan", FUB_NS, "join", join);
        return join;
      });
    }
    const node = this.target(op.id);
    this.guard(node, true);
    if (roleOf(node) !== "text") reject("invalid-elem", `${op.id} non è un testo`);
    const before = this.reread(node);
    if (node.details!.textPath !== undefined) return this.textAlong(node, lines, joins);
    const previous: TextLine[] = [];
    const previousJoins: Array<string | null> = [];
    for (const child of before.element.children) {
      const tspan = before.fragment.doc.element(child);
      if (tspan === null || !isSvg(tspan, "tspan")) continue;
      previous.push(readRuns(before.fragment.doc, tspan) ?? node.details!.lines![previous.length]!);
      previousJoins.push(valueOf(tspan, NS_FUB, "join") ?? null);
    }
    const built = this.rewriteLeaf(node, (out, { fragment, element, scope }) => {
      const doc = fragment.doc;
      const others: OutElement[] = [];
      const tspans: ElementNode[] = [];
      for (const child of element.children) {
        const read = doc.element(child);
        if (read === null) continue;
        if (isSvg(read, "tspan")) tspans.push(read);
        else others.push(elementToOut(doc, child));
      }
      // Una riga nuova copia gli attributi della precedente, senza id e senza
      // `fub:join`, perché comincia un paragrafo, e va giù di un'interlinea:
      // quella delle righe che ci sono già, oppure 1,25 volte il corpo con cui
      // si vede l'ultima riga.
      let spacing: string | null = null;
      for (let k = tspans.length - 1; k >= 1 && spacing === null; k--) spacing = valueOf(tspans[k]!, NS_NONE, "dy") ?? null;
      if (spacing === null) {
        const last = tspans.length === 0 ? [] : [tspans[tspans.length - 1]!];
        spacing = formatNumber(this.fontSize([...last, element], node.parent) * 1.25, 2);
      }
      const name = scope.svgName("tspan")!;
      const isJoin = (a: OutAttr): boolean => a.uri === FUB_NS && a.local === "join";
      const written: OutElement[] = [];
      for (let i = 0; i < lines.length; i++) {
        let attrs: OutAttr[];
        if (i < tspans.length) {
          attrs = attributesOf(doc, tspans[i]!);
        } else {
          const dy: OutAttr = { name: "dy", uri: "", local: "dy", text: escapeAttribute(i === 0 ? "0" : spacing) };
          const base = i > 0
            ? written[i - 1]!.attrs.filter((a) => !(a.uri === "" && (a.local === "id" || a.local === "dy")) && !isJoin(a))
            : attributesOf(doc, element).filter((a) => a.uri === "" && a.local === "x");
          attrs = [...base, dy];
        }
        const join = joins?.[i];
        if (join !== undefined) {
          attrs = attrs.filter((a) => !isJoin(a));
          if (join !== null) attrs.push({ ...elemGuard(() => attributeName("fub:join", scope)), text: escapeAttribute(join) });
        }
        attrs = canonicalOrder(attrs);
        const line = lines[i]!;
        const text = typeof line === "string" ? escapeText(line) : elemGuard(() => lineContent(line, scope));
        written.push({ name, group: false, attrs, children: [], text });
      }
      return { ...out, children: [...others, ...written] };
    });
    // Un pezzo con un attributo che il formato non gli dà renderebbe
    // estraneo il testo.
    const problem = this.problem(built);
    if (problem !== null) reject("invalid-elem", problem);
    this.touched.add(op.id);
    // L'inversa rimette i `fub:join` di prima anche se l'operazione non ne
    // aveva: una riga che se ne va riprende il suo quando torna.
    const joined = joins !== null || previousJoins.some((join) => join !== null);
    return joined ? { op: "text", id: op.id, lines: previous, joins: previousJoins } : { op: "text", id: op.id, lines: previous };
  }

  /// `text` di un testo su tracciato: la sua riga sola è il contenuto del
  /// `textPath`, che tiene i suoi attributi (formato della scena, testo).
  private textAlong(node: ElementPart, lines: readonly TextLine[], joins: readonly (string | null)[] | null): Op {
    if (lines.length !== 1) reject("invalid-elem", "un testo su tracciato ha una riga sola");
    if (joins !== null) reject("invalid-elem", "un testo su tracciato non va a capo");
    const id = node.facts.id!;
    const line = lines[0]!;
    let previous: TextLine = node.details!.lines![0]!;
    const built = this.rewriteLeaf(node, (out, { fragment, element, scope }) => {
      const doc = fragment.doc;
      const children: OutElement[] = [];
      for (const child of element.children) {
        const read = doc.element(child);
        if (read === null) continue;
        if (!isSvg(read, "textPath")) {
          children.push(elementToOut(doc, child));
          continue;
        }
        previous = readRuns(doc, read) ?? previous;
        const text = typeof line === "string" ? escapeText(line) : elemGuard(() => lineContent(line, scope));
        children.push({ name: read.name, group: false, attrs: canonicalOrder(attributesOf(doc, read)), children: [], text });
      }
      return { ...out, children };
    });
    const problem = this.problem(built);
    if (problem !== null) reject("invalid-elem", problem);
    this.touched.add(id);
    return { op: "text", id, lines: [previous] };
  }

  /// Il corpo con cui si vede il primo di `elements`, dal più interno al
  /// più esterno, dentro `container`: il primo `font-size` valido che si
  /// incontra salendo, 16 se nessuno lo scrive.
  private fontSize(elements: readonly ElementNode[], container: ContainerNode | null): number {
    const sizeOf = (element: ElementNode): number | null => {
      const value = valueOf(element, NS_NONE, "font-size");
      return value === undefined ? null : svgLength(value);
    };
    for (const element of elements) {
      const size = sizeOf(element);
      if (size !== null && size >= 0) return size;
    }
    for (let c = container; c !== null; c = c.parent) {
      const size = sizeOf(this.reread(c).element);
      if (size !== null && size >= 0) return size;
    }
    return 16;
  }

  protected ident(op: Record<string, unknown>): Op {
    if (!isPath(op.path) || op.path.length === 0 || typeof op.tag !== "string" || (op.id !== null && typeof op.id !== "string")) {
      reject("invalid-elem", "ident non valido");
    }
    const { path, tag } = op;
    const id = op.id as string | null;
    const node = this.walk(path);
    if (node === null || tagName(node) !== tag) reject("missing-target", `nessun ${tag} al percorso ${JSON.stringify(path)}`);
    if ((id === null) === (node.facts.id === null)) {
      reject("missing-target", id === null ? "l'elemento non ha un id da togliere" : "l'elemento ha già un id");
    }
    this.guard(node, true);
    this.sheet(node);
    const old = node.facts.id;
    // Senza id una risorsa è estranea, e chi la usa con lei (§2); uno stile
    // lo è, e chi lo segue non lo segue più.
    const followers = node.details?.lifecycle === "style" ? this.t.followers(old!) : 0;
    const resource = roleOf(node) === "resource" || roleOf(node) === "symbol";
    if (id === null && resource && this.t.referrers(old!) + followers > 0) reject("in-use", `qualcosa usa ${old}`);
    if (id !== null) {
      // Ogni id che il formato ammette, non solo quelli che FubDraw genera:
      // un id si cambia togliendolo e dandone un altro, e l'undo rimette
      // quello di prima com'era scritto. Il gruppo di una pagina annotata
      // ha l'id dal suo numero.
      if (id === "") reject("invalid-elem", "id vuoto");
      this.checkValue(tag, "", "id", id);
      const page = this.pageNumber(node);
      if (page !== null && id !== pageId(page)) reject("invalid-elem", `id non valido per la pagina: ${JSON.stringify(id)}`);
      if (this.t.has(id)) reject("duplicate-id", `id già usato: ${id}`);
    }
    // Si tocca solo l'attributo, nel testo del tag: gli altri restano come
    // sono scritti, anche su più righe (§6).
    const { fragment, element } = this.reread(node);
    const raw = node.kind === "leaf" ? node.raw : node.head;
    let patched: string;
    if (id === null) {
      const [from, to] = attributeSpan(fragment.doc, element, element.attrs.find((a) => a.ns === NS_NONE && a.local === "id")!);
      patched = raw.slice(0, from) + raw.slice(to);
    } else {
      const at = 1 + element.name.length;
      patched = `${raw.slice(0, at)} id="${escapeAttribute(id)}"${raw.slice(at)}`;
    }
    if (node.kind === "container") this.setHead(node, patched, node.tail);
    else this.sheet(this.replaceLeaf(node, patched));
    this.touched.add(id ?? old!);
    return { op: "ident", path: [...path], tag, id: id === null ? old : null };
  }

  // -------------------------------------------------------------------------
  // page, meta e adopt: la radice.
  // -------------------------------------------------------------------------

  protected page(op: Record<string, unknown>): Op {
    const root = this.t.model.root;
    // Le carte delle tavole hanno la geometria delle loro tavole (formato
    // della scena, tavole).
    const papers = elementChildren(root).filter(isPagePaper);
    const value = (element: ElementNode, local: string): string | null => valueOf(element, NS_NONE, local) ?? null;
    const rootElement = this.reread(root).element;
    const firstPaper = papers[0] === undefined ? null : this.reread(papers[0]).element;
    const previous: PagePrevious = {
      root: { viewBox: value(rootElement, "viewBox"), width: value(rootElement, "width"), height: value(rootElement, "height") },
      paper: firstPaper === null
        ? null
        : { x: value(firstPaper, "x"), y: value(firstPaper, "y"), width: value(firstPaper, "width"), height: value(firstPaper, "height") },
    };

    let rootValues: Record<string, string | null>;
    let paperValues: Record<string, string | null> | null;
    if (op.previous !== undefined) {
      // L'inversa rimette i valori di prima così come erano.
      const given = op.previous;
      if (!isRecord(given) || !isRecord(given.root) || (given.paper !== null && !isRecord(given.paper))) {
        reject("invalid-elem", "page non valido");
      }
      const strings = (record: Record<string, unknown>, keys: readonly string[]): Record<string, string | null> => {
        const out: Record<string, string | null> = {};
        for (const key of keys) {
          const v = record[key];
          if (v !== null && typeof v !== "string") reject("invalid-elem", `valore non valido per ${key}`);
          out[key] = v;
        }
        return out;
      };
      rootValues = strings(given.root, ["viewBox", "width", "height"]);
      paperValues = given.paper === null ? null : strings(given.paper as Record<string, unknown>, ["x", "y", "width", "height"]);
    } else {
      if (typeof op.viewBox !== "string") reject("invalid-elem", "viewBox assente");
      const tokens = op.viewBox.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "").split(/[ \t\r\n,]+/);
      const numbers = tokens.map((token) => svgNumber(token));
      if (tokens.length !== 4 || numbers.some((n) => n === null) || numbers[2]! <= 0 || numbers[3]! <= 0) {
        reject("invalid-elem", `viewBox non valido: ${JSON.stringify(op.viewBox)}`);
      }
      const [x, y, w, h] = tokens as [string, string, string, string];
      rootValues = { viewBox: `${x} ${y} ${w} ${h}`, width: w, height: h };
      paperValues = { x, y, width: w, height: h };
    }
    for (const [local, v] of Object.entries(rootValues)) if (v !== null) this.checkValue("svg", "", local, v);
    if (paperValues !== null) for (const [local, v] of Object.entries(paperValues)) if (v !== null) this.checkValue("rect", "", local, v);
    const assign = (values: Record<string, string | null>) => (attrs: OutAttr[]): OutAttr[] => {
      const out: OutAttr[] = [];
      const done = new Set<string>();
      for (const attr of attrs) {
        if (attr.uri !== "" || !(attr.local in values)) {
          out.push(attr);
          continue;
        }
        done.add(attr.local);
        const v = values[attr.local];
        if (v !== null && v !== undefined) out.push({ ...attr, text: escapeAttribute(v) });
      }
      for (const [local, v] of Object.entries(values)) {
        if (!done.has(local) && v !== null) out.push({ name: local, uri: "", local, text: escapeAttribute(v) });
      }
      return out;
    };
    this.rewriteHead(root, assign(rootValues), root.tail === null);
    if (paperValues !== null) {
      const values = paperValues;
      for (const paper of papers) {
        const built = this.rewriteLeaf(paper, (out, read) => ({
          ...out,
          attrs: canonicalOrder(assign(values)(attributesOf(read.fragment.doc, read.element))),
        }));
        if (roleOf(built) !== "paper") reject("invalid-elem", "la carta riscritta non rientra nel formato");
        this.touch(built);
      }
    }
    return { op: "page", viewBox: previous.root.viewBox ?? "", previous };
  }

  protected meta(op: Record<string, unknown>): Op {
    const root = this.t.model.root;
    const fields = (["title", "desc"] as const).filter((field) => op[field] !== undefined);
    for (const field of fields) {
      const v = op[field];
      if (v !== null && (typeof v !== "string" || !isXmlText(v))) reject("invalid-elem", `${field} non valido`);
    }
    const find = (local: string): ElementPart | null =>
      elementChildren(root).find((child) => child.facts.uri === SVG_NS && child.facts.local === local) ?? null;
    const inverse: { -readonly [K in keyof MetaOp]: MetaOp[K] } = { op: "meta" };
    for (const field of fields) {
      const existing = find(field);
      if (existing !== null && existing.details === null) reject("foreign", `il ${field} della radice è estraneo`);
      inverse[field] = existing === null ? null : (existing.details!.text ?? "");
    }
    for (const field of fields) {
      const v = op[field] as string | null;
      const existing = find(field);
      if (v === null) {
        if (existing !== null) this.detach(existing);
        continue;
      }
      if (existing !== null) {
        this.rewriteLeaf(existing, (out) => ({ ...out, text: escapeText(v) }));
        continue;
      }
      // Il titolo va per primo, la descrizione subito dopo il titolo.
      const out = elemGuard(() => elemToOut({ tag: field, attrs: {}, text: v }, scopeOf(root)));
      const title = field === "desc" ? find("title") : null;
      const model = this.t.model;
      let to: Destination;
      if (this.collapsed(root)) {
        to = { kind: "empty", parent: root, indent: `${indentOf(model, root)}  ` };
      } else if (title !== null) {
        const point = { owner: root, index: root.parts.indexOf(title) + 1, split: 0 };
        to = { kind: "point", point, gap: this.eolOf(`\n${indentOf(model, title)}`) };
      } else {
        to = { kind: "point", point: { owner: root, index: 0, split: 0 }, gap: this.eolOf(`\n${indentOf(model, root)}  `) };
      }
      const node = this.build(this.eolOf(writeElement(out, this.indentFor(to))), root);
      if (node === null || node.details === null) reject("invalid-elem", `${field} non rientra nel formato`);
      this.place(to, [node]);
    }
    return inverse;
  }

  /// Impronta e numero di pagine sulla radice di un `.fubann`. Si tocca solo
  /// il valore di ciascuno, o lo si aggiunge in coda al tag: il resto della
  /// radice resta com'è scritto, come in `adopt`. Uno dei due può mancare, e
  /// allora resta com'è; mancano tutti e due, è un rifiuto. L'inversa rimette
  /// i valori di prima così come erano, anche fuori grammatica.
  protected anchor(op: Record<string, unknown>): Op {
    if (this.t.status !== "fubdraw") reject("invalid-elem", "il documento non è un disegno di Fub");
    const root = this.t.model.root;
    const { fragment, element, scope } = this.reread(root);
    const prefix = scope.attributePrefix(FUB_NS);
    if (prefix === null) reject("invalid-elem", "la radice non dichiara il namespace dei disegni di Fub");
    const written = (local: string): Attr | undefined =>
      element.attrs.find((a) => fragment.doc.namespaces[a.ns] === FUB_NS && a.local === local);
    const previous: AnchorPrevious = {
      digest: written("digest")?.value ?? null,
      pages: written("pages")?.value ?? null,
    };
    // `undefined`: il valore resta com'è.
    let values: { digest?: string | null; pages?: string | null };
    if (op.previous !== undefined) {
      const given = op.previous;
      if (!isRecord(given) || (given.digest !== null && typeof given.digest !== "string") || (given.pages !== null && typeof given.pages !== "string")) {
        reject("invalid-elem", "anchor non valido");
      }
      values = { digest: given.digest as string | null, pages: given.pages as string | null };
    } else {
      const { digest, pages } = op;
      if (digest === undefined && pages === undefined) reject("invalid-elem", "anchor senza impronta né pagine");
      if (digest !== undefined && (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest))) {
        reject("invalid-elem", "l'impronta non è sha256: e 64 cifre minuscole");
      }
      if (pages !== undefined && (typeof pages !== "number" || !Number.isSafeInteger(pages) || pages < 1 || pages > 0xffff_ffff)) {
        reject("invalid-elem", "il numero di pagine non è un intero positivo");
      }
      values = {};
      if (digest !== undefined) values.digest = digest as string;
      if (pages !== undefined) values.pages = String(pages);
    }
    for (const [local, v] of Object.entries(values)) if (typeof v === "string") this.checkValue("svg", FUB_NS, local, v);
    // Le modifiche dalla fine del tag, così gli indici di prima valgono; gli
    // attributi nuovi vanno dopo l'ultimo, l'impronta prima delle pagine.
    const edits: Array<{ from: number; to: number; text: string }> = [];
    const last = element.attrs[element.attrs.length - 1];
    const end = last === undefined ? 1 + element.name.length : last.raw[1] + 1 - element.start;
    let added = "";
    for (const local of ["digest", "pages"] as const) {
      const v = values[local];
      if (v === undefined) continue;
      const attr = written(local);
      if (attr !== undefined) {
        if (v === null) {
          const [from, to] = attributeSpan(fragment.doc, element, attr);
          edits.push({ from, to, text: "" });
        } else {
          // Fra apici singoli anche l'apice si scrive come riferimento.
          const quote = fragment.doc.source.text[attr.raw[0] - 1];
          const text = quote === "'" ? escapeAttribute(v).replace(/'/g, "&#39;") : escapeAttribute(v);
          edits.push({ from: attr.raw[0] - element.start, to: attr.raw[1] - element.start, text });
        }
      } else if (v !== null) {
        added += ` ${prefix}:${local}="${escapeAttribute(v)}"`;
      }
    }
    if (added !== "") edits.push({ from: end, to: end, text: added });
    edits.sort((a, b) => b.from - a.from || b.to - a.to);
    let head = root.head;
    for (const { from, to, text } of edits) head = head.slice(0, from) + text + head.slice(to);
    if (head !== root.head) this.setHead(root, head, root.tail);
    return { op: "anchor", previous };
  }

  protected adopt(op: Record<string, unknown>): Op {
    if (op.undo !== undefined && typeof op.undo !== "boolean") reject("invalid-elem", "adopt non valido");
    const root = this.t.model.root;
    const { fragment, element, scope } = this.reread(root);
    const head = root.head;
    if (op.undo !== true) {
      if (this.t.status !== "foreign") reject("invalid-elem", "il documento è già un disegno di Fub");
      // Il prefisso di FubDraw: quello già legato al suo namespace, oppure
      // `fub`, oppure il primo `fubN` libero.
      let prefix = scope.attributePrefix(FUB_NS);
      let added = "";
      if (prefix === null) {
        prefix = "fub";
        for (let n = 1; scope.uri(prefix) !== null; n++) prefix = `fub${n}`;
        added = ` xmlns:${prefix}="${escapeAttribute(FUB_NS)}"`;
      }
      // Dopo l'ultima dichiarazione, o subito dopo il nome: il resto del tag
      // resta com'è scritto (§6).
      const declarations = element.attrs.filter((a) => fragment.doc.namespaces[a.ns] === XMLNS_URI);
      const last = declarations[declarations.length - 1];
      const at = last === undefined ? 1 + element.name.length : last.raw[1] + 1 - element.start;
      this.setHead(root, `${head.slice(0, at)}${added} ${prefix}:version="1"${head.slice(at)}`, root.tail);
      this.t.setStatus("fubdraw");
      return { op: "adopt", undo: true };
    }
    if (this.t.status !== "fubdraw") reject("invalid-elem", "il documento non è un disegno di Fub");
    const version = element.attrs.find((a) => fragment.doc.namespaces[a.ns] === FUB_NS && a.local === "version");
    if (version === undefined) reject("invalid-elem", "la radice non ha fub:version");
    const removed: Array<[number, number]> = [attributeSpan(fragment.doc, element, version)];
    // La dichiarazione va via solo se nient'altro usa il prefisso.
    const prefix = version.name.slice(0, version.name.indexOf(":"));
    const declaration = element.attrs.find((a) => fragment.doc.namespaces[a.ns] === XMLNS_URI && a.name === `xmlns:${prefix}`);
    if (declaration !== undefined) {
      const uses = new RegExp(`[\\s<]${prefix.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}:`);
      const own = element.attrs.some((a) => a !== version && a.name.startsWith(`${prefix}:`));
      const inside = root.parts.some((part) => typeof part !== "string" && part.kind !== "other" && uses.test(rawOf(part)));
      if (!own && !inside) removed.push(attributeSpan(fragment.doc, element, declaration));
    }
    removed.sort((a, b) => b[0] - a[0]);
    let patched = head;
    for (const [from, to] of removed) patched = patched.slice(0, from) + patched.slice(to);
    this.setHead(root, patched, root.tail);
    this.t.setStatus("foreign");
    return { op: "adopt" };
  }
}
