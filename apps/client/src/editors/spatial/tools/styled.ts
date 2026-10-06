// Ciò che i fogli di stile di un disegno scelgono, prima e dopo un comando
// che sposta gli elementi senza cambiarli: raggruppare e separare, collegare e
// togliere un collegamento, riordinare, cambiare livello. Un foglio che
// sceglie per posizione, come `#m .node rect` di Mermaid, dopo il comando
// sceglierebbe altro, e ciò che si vede cambierebbe senza che lo si sia
// chiesto; e gli elementi estranei, che il foglio colora, non si possono
// riscrivere perché restino com'erano. Allora il comando non si fa.
//
// - **Dove guarda:** gli elementi che cambiano posto, quelli che hanno
//   accanto un fratello nuovo, uno in meno o in un altro ordine, e ciò che
//   contengono; con un `:has()` nel foglio, tutti.
// - **Che cosa conta come cambiamento:** un selettore che sceglie un elemento
//   prima e non dopo, o il contrario, o di cui non si sa; un contenitore che
//   se ne va, o che arriva, scelto da un selettore, perché ciò che contiene
//   ne eredita lo stile; un foglio che cambia posto rispetto agli altri.
// - **Senza fogli non costa niente:** un disegno senza `<style>` non si
//   legge.

import type { Elem } from "../scene/serialize";
import { ROOT, type Op, type Pos, type Target } from "../scene/ops";
import { SourceText } from "../scene/text";
import { FUB_NS, parseXml, SVG_NS, XLINK_NS, XML_URI, type XmlDocument } from "../scene/xml";
import { Matcher, readSheet, type Selector, type StyleAttr, type StyleNode } from "./selectors";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/// Vero se `text` contiene un elemento `style`, con o senza prefisso.
const hasStyle = (text: string): boolean => /<(?:[\w.-]+:)?style[\s>/]/.test(text);

/// I tag che non si disegnano: che se ne vadano o arrivino non cambia niente.
const UNSEEN: ReadonlySet<string> = new Set(["title", "desc", "metadata"]);

/// I namespace dei prefissi che le operazioni scrivono.
const PREFIXES: ReadonlyMap<string, string> = new Map([
  ["xlink", XLINK_NS],
  ["fub", FUB_NS],
  ["xml", XML_URI],
]);

/// Un elemento del documento come lo vede un selettore; si sposta come
/// chiedono le operazioni.
class Node implements StyleNode {
  parent: Node | null = null;
  children: Node[] = [];

  constructor(
    readonly uri: string,
    readonly local: string,
    public attrs: StyleAttr[],
    public text: boolean,
    /// Il foglio, per un `style` che ne porta uno.
    readonly sheet: string | null,
  ) {}

  id(): string | null {
    return this.attrs.find((attr) => attr.uri === "" && attr.local === "id")?.value ?? null;
  }
}

/// L'albero degli elementi di `doc`, dalla radice.
function treeOf(doc: XmlDocument): Node {
  const build = (id: number, parent: Node | null): Node => {
    const element = doc.element(id)!;
    const uri = doc.namespaces[element.ns]!;
    const attrs = element.attrs
      .filter((attr) => attr.name !== "xmlns" && !attr.name.startsWith("xmlns:"))
      .map((attr) => ({ uri: doc.namespaces[attr.ns]!, local: attr.local, value: attr.value }));
    let text = false;
    let css = "";
    for (const child of doc.children(id)) {
      const node = doc.nodes[child]!;
      if (node.kind === "text" || node.kind === "cdata") {
        text = true;
        css += node.value;
      } else if (node.kind === "entity-ref") {
        text = true;
        css += doc.plainEntity(node.name) ?? "";
      }
    }
    const type = attrs.find((attr) => attr.uri === "" && attr.local === "type")?.value.trim().toLowerCase() ?? "";
    const sheet = element.local === "style" && (uri === SVG_NS || uri === XHTML_NS) && (type === "" || type === "text/css") ? css : null;
    const node = new Node(uri, element.local, attrs, text, sheet);
    node.parent = parent;
    return node;
  };
  // Una visita con la pila: un SVG con centomila gruppi annidati è valido.
  const root = build(doc.root, null);
  const stack: Array<[number, Node]> = [[doc.root, root]];
  while (stack.length > 0) {
    const [id, node] = stack.pop()!;
    for (const child of doc.children(id)) {
      if (doc.element(child) === null) continue;
      const built = build(child, node);
      node.children.push(built);
      stack.push([child, built]);
    }
  }
  return root;
}

/// Gli elementi di `root` in ordine di documento, lui compreso.
function walk(root: Node): Node[] {
  const out: Node[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node);
    for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]!);
  }
  return out;
}

/// Una copia di `root`, e per ogni elemento della copia il suo originale.
function cloneTree(root: Node): [Node, Map<Node, Node>] {
  const original = new Map<Node, Node>();
  const copy = (node: Node, parent: Node | null): Node => {
    const made = new Node(node.uri, node.local, [...node.attrs], node.text, node.sheet);
    made.parent = parent;
    original.set(made, node);
    return made;
  };
  const top = copy(root, null);
  const stack: Array<[Node, Node]> = [[root, top]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    for (const child of from.children) {
      const made = copy(child, to);
      to.children.push(made);
      stack.push([child, made]);
    }
  }
  return [top, original];
}

/// Un attributo scritto da un'operazione: il nome col prefisso.
function attrOf(name: string, value: string): StyleAttr {
  const colon = name.indexOf(":");
  if (colon < 0) return { uri: "", local: name, value };
  const prefix = name.slice(0, colon);
  return { uri: PREFIXES.get(prefix) ?? `urn:prefix:${prefix}`, local: name.slice(colon + 1), value };
}

/// L'elemento di un'operazione `add`.
function nodeOf(elem: Elem, parent: Node): Node {
  const node = new Node(SVG_NS, elem.tag, Object.entries(elem.attrs).map(([name, value]) => attrOf(name, value)), (elem.text ?? "") !== "", null);
  node.parent = parent;
  node.children = (elem.children ?? []).map((child) => nodeOf(child, node));
  return node;
}

/// Un'operazione che qui non si sa seguire.
class Unfollowed extends Error {}

/// Le operazioni applicate all'albero: gli elementi si spostano, arrivano e
/// se ne vanno come nel motore.
class Follower {
  /// I contenitori che hanno avuto figli nuovi, tolti o riordinati, o un
  /// figlio con attributi cambiati.
  readonly touched = new Set<Node>();
  readonly added = new Set<Node>();
  readonly removed = new Set<Node>();
  private readonly ids = new Map<string, Node>();

  constructor(private readonly root: Node) {
    for (const node of walk(root)) {
      const id = node.id();
      if (id !== null && !this.ids.has(id)) this.ids.set(id, node);
    }
  }

  apply(op: Op): void {
    switch (op.op) {
      case "batch":
        for (const inner of op.ops) this.apply(inner);
        return;
      case "ident": {
        const node = this.byPath(op.path);
        this.setAttrs(node, { id: op.id });
        return;
      }
      case "set":
        this.setAttrs(this.byId(op.id), op.attrs);
        return;
      case "add": {
        if (!("elem" in op)) throw new Unfollowed();
        const parent = this.parentOf(op.parent);
        const node = nodeOf(op.elem, parent);
        this.insert(node, parent, op.pos);
        for (const made of walk(node)) {
          this.added.add(made);
          const id = made.id();
          if (id !== null) this.ids.set(id, made);
        }
        return;
      }
      case "move": {
        if (!("parent" in op)) throw new Unfollowed();
        const node = this.find(op.target);
        this.detach(node);
        this.insert(node, this.parentOf(op.parent), op.pos);
        return;
      }
      case "remove": {
        const node = this.find(op.target);
        this.detach(node);
        for (const gone of walk(node)) {
          if (this.added.delete(gone)) continue;
          this.removed.add(gone);
          const id = gone.id();
          if (id !== null && this.ids.get(id) === gone) this.ids.delete(id);
        }
        return;
      }
      case "text":
        this.byId(op.id).text = op.lines.length > 0;
        this.touch(this.byId(op.id));
        return;
      // La pagina cambia `viewBox` e la carta, che un foglio non sceglie.
      case "page":
        return;
      default:
        throw new Unfollowed();
    }
  }

  private touch(node: Node): void {
    this.touched.add(node.parent ?? node);
  }

  private setAttrs(node: Node, attrs: Readonly<Record<string, string | null>>): void {
    for (const [name, value] of Object.entries(attrs)) {
      const made = attrOf(name, value ?? "");
      const id = made.uri === "" && made.local === "id" ? node.id() : undefined;
      node.attrs = node.attrs.filter((attr) => !(attr.uri === made.uri && attr.local === made.local));
      if (value !== null) node.attrs.push(made);
      if (id !== undefined) {
        if (id !== null && this.ids.get(id) === node) this.ids.delete(id);
        if (value !== null) this.ids.set(value, node);
      }
    }
    this.touch(node);
  }

  private byId(id: string): Node {
    const node = this.ids.get(id);
    if (node === undefined) throw new Unfollowed();
    return node;
  }

  private byPath(path: readonly number[]): Node {
    let node = this.root;
    for (const at of path) {
      const child = node.children[at];
      if (child === undefined) throw new Unfollowed();
      node = child;
    }
    return node;
  }

  private find(target: Target): Node {
    return typeof target === "string" ? this.byId(target) : this.byPath(target.path);
  }

  private parentOf(parent: string): Node {
    return parent === ROOT ? this.root : this.byId(parent);
  }

  private detach(node: Node): void {
    const parent = node.parent;
    if (parent === null) throw new Unfollowed();
    parent.children.splice(parent.children.indexOf(node), 1);
    node.parent = null;
    this.touched.add(parent);
  }

  private insert(node: Node, parent: Node, pos: Pos): void {
    let at: number;
    if ("first" in pos) at = 0;
    else if ("last" in pos) at = parent.children.length;
    else {
      const after = parent.children.indexOf(this.byId(pos.after));
      if (after < 0) throw new Unfollowed();
      at = after + 1;
    }
    parent.children.splice(at, 0, node);
    node.parent = parent;
    this.touched.add(parent);
  }
}

/// Vero se `ops`, applicate al disegno `text`, cambiano ciò che un suo
/// foglio di stile sceglie: vedi l'intestazione.
export function restyles(text: string, ops: readonly Op[]): boolean {
  if (!hasStyle(text)) return false;
  let before: Node;
  try {
    before = treeOf(parseXml(new SourceText(text), false));
  } catch {
    return false;
  }
  const order = walk(before);
  const styles = order.filter((node) => node.sheet !== null);
  if (styles.length === 0) return false;
  const selectors: Selector[] = [];
  let deep = false;
  for (const style of styles) {
    const sheet = readSheet(style.sheet!);
    selectors.push(...sheet.selectors);
    deep ||= sheet.deep;
  }
  if (selectors.length === 0) return false;

  const [after, original] = cloneTree(before);
  const follower = new Follower(after);
  try {
    for (const op of ops) follower.apply(op);
  } catch (error) {
    if (error instanceof Unfollowed) return true;
    throw error;
  }

  const old = new Matcher();
  const now = new Matcher();
  const chosen = (matcher: Matcher, node: Node): boolean => selectors.some((selector) => matcher.selects(selector, node) !== false);

  // Un contenitore che se ne va, o che arriva: ciò che contiene ne eredita
  // lo stile.
  for (const gone of follower.removed) {
    const was = original.get(gone)!;
    if (was.sheet !== null) return true;
    if (!UNSEEN.has(was.local) && chosen(old, was)) return true;
  }
  for (const made of follower.added) if (!UNSEEN.has(made.local) && chosen(now, made)) return true;

  // I fogli nello stesso ordine: a parità di selettore vince l'ultimo.
  const later = walk(after).filter((node) => node.sheet !== null).map((node) => original.get(node));
  if (later.length !== styles.length || later.some((node, at) => node !== styles[at])) return true;

  // Un contenitore che se n'è andato non si guarda: lo dice già chi lo ha
  // tolto.
  const places = deep ? [after] : [...follower.touched].filter((place) => !follower.removed.has(place));
  const seen = new Set<Node>();
  for (const place of places) {
    for (const node of walk(place)) {
      if (seen.has(node) || follower.added.has(node) || follower.removed.has(node)) continue;
      seen.add(node);
      const was = original.get(node)!;
      for (const selector of selectors) {
        const then = old.selects(selector, was);
        if (then === null || then !== now.selects(selector, node)) return true;
      }
    }
  }
  return false;
}
