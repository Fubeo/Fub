// Ciò che si vede resta, dopo un comando che sposta gli elementi senza
// cambiarli: raggruppare e separare, collegare e togliere un collegamento,
// riordinare, cambiare livello, spostare nell'albero. Un foglio di stile che
// sceglie per posizione, come `#m .node rect` di Mermaid, dopo il comando
// sceglierebbe altro; un gruppo che se ne va porta via la trasformazione e lo
// stile che ereditavano i suoi figli di un altro programma. Allora si scrive
// su ogni elemento che cambierebbe aspetto lo stile che aveva, e il comando
// si fa.
//
// - **Come lo vede un browser:** lo stile di prima e quello di dopo si
//   calcolano con la cascata di CSS (`cascade.ts`): fogli, attributo
//   `style`, attributi di presentazione, eredità, trasformazioni e opacità
//   accumulate. Si confrontano gli elementi che il comando tocca: quelli che
//   cambiano posto, quelli che hanno accanto un fratello nuovo, uno in meno o
//   in un altro ordine, e ciò che contengono; tutti, se il foglio guarda
//   dentro gli elementi con `:has()`.
// - **Dall'alto in basso, il meno possibile:** su un elemento si scrivono
//   solo le proprietà che vi si vedono, o che passano ai figli; ciò che si
//   scrive su un contenitore vale per i figli, che poi non ne hanno bisogno.
//   Un oggetto riceve attributi con `set`; un elemento di un altro programma
//   si riscrive, con un attributo di presentazione se basta, se no con
//   l'attributo `style`, anche `!important` se serve. La parte estranea che
//   il comando sposta si toglie e si rimette riscritta dove andava; una che
//   resta dov'è si riscrive al suo posto.
// - **Le copie collegate:** un `use` che mostra un elemento a cui cambia la
//   trasformazione o l'opacità le compensa su di sé; se all'elemento cambia
//   altro, o se ne va, il comando non si fa.
// - **Ciò che non si sa scrivere non si fa:** un effetto di un contenitore
//   che se ne va, come un filtro; uno stile che dipende da dove si guarda il
//   disegno; un selettore che non si legge; un valore che un oggetto del
//   formato non ammette. Il comando non si fa, e si dice perché.
// - **Alla fine si ricontrolla:** lo stile di dopo, con tutto ciò che si è
//   scritto, si ricalcola da capo e si confronta con quello di prima.
// - **Un disegno tutto nel formato non chiede niente:** senza parti estranee
//   non ci sono fogli, `style` né copie, e le operazioni dei comandi portano
//   già la trasformazione, l'opacità e gli attributi ereditati; non si legge
//   nemmeno il testo.

import { svgAttribute, type Tag } from "../scene/classify";
import { createId, type IdKind } from "../scene/ids";
import { compose, IDENTITY, invert, type Matrix } from "../scene/matrix";
import { buildFragment, elementChildren, indentOf, parseFragment, scopeOf, tagName, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import { ROOT, type Op, type Pos, type Target } from "../scene/ops";
import { escapeAttribute, formatTransform, type Elem } from "../scene/serialize";
import { SourceText } from "../scene/text";
import { length as svgLength, NAMED_COLORS, paint } from "../scene/values";
import { FUB_NS, isSpace, parseXml, SVG_NS, XLINK_NS, XML_URI, type Attr, type ElementNode, type XmlDocument } from "../scene/xml";
import { formatNumber } from "../number";
import {
  Cascade,
  EFFECTS,
  IGNORED,
  INHERITED,
  inherits,
  longhands,
  readOpacity,
  renders,
  RESOURCES,
  same,
  sameAlpha,
  sameWorld,
  SILENT,
  type Alpha,
  type CascadeNode,
  type Doubt,
  type Value,
  type World,
} from "./cascade";
import { attributeNames, readDeclarations, readSheets, type Sheet, type StyleAttr } from "./selectors";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/// Perché un comando non si fa: ciò che cambierebbe aspetto e non si sa
/// riscrivere com'era.
export type Refusal =
  /// Un selettore che non si legge sceglie forse un elemento che cambia.
  | { readonly kind: "selector"; readonly text: string }
  /// Uno stile che dipende da dove si guarda il disegno.
  | { readonly kind: "condition"; readonly text: string }
  /// Un effetto del contenitore che se ne va.
  | { readonly kind: "lost"; readonly property: string }
  /// Un effetto che il foglio darebbe al contenitore nuovo.
  | { readonly kind: "new"; readonly property: string }
  /// Una proprietà di un elemento che non si sa riscrivere.
  | { readonly kind: "object"; readonly property: string }
  /// Una copia collegata cambierebbe.
  | { readonly kind: "copy" }
  /// Un foglio ne importa un altro, che non si legge.
  | { readonly kind: "import" }
  /// Qualcosa che qui non si sa seguire.
  | { readonly kind: "unknown" };

/// Le operazioni di un comando con ciò che serve perché si veda com'era, e
/// su quanti elementi si è scritto per questo.
export interface Kept {
  readonly ops: readonly Op[];
  readonly written: number;
}

export interface Keeping {
  /// `keep` se tutto resta come si vedeva; `take` se chi cambia contenitore
  /// ne prende l'opacità e la visibilità, come quando lo si porta in un altro
  /// livello o in un altro gruppo.
  readonly containers: "keep" | "take";
  /// Vero se un id è già nel documento.
  readonly taken: (id: string) => boolean;
}

/// I servizi di caratteri: i fogli che si importano da loro dichiarano solo
/// caratteri.
const FONT_SERVICES = /^(?:https?:)?\/\/(?:fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|fonts\.cdnfonts\.com|api\.fontshare\.com)\//i;

/// I namespace dei prefissi che le operazioni scrivono.
const PREFIXES: ReadonlyMap<string, string> = new Map([
  ["xlink", XLINK_NS],
  ["fub", FUB_NS],
  ["xml", XML_URI],
]);

/// Le proprietà che si confrontano per prime, perché le altre ne dipendono.
const FIRST: readonly string[] = ["font-size", "color"];

/// Le proprietà che non si confrontano da sole: trasformazione e opacità si
/// accumulano, e si confrontano così.
const ACCUMULATED: ReadonlySet<string> = new Set(["transform", "transform-origin", "transform-box", "translate", "rotate", "scale", "opacity"]);

/// I decimali di un'opacità o di una trasformazione scritte.
const PLACES = 4;

let serials = 0;

/// Un elemento del documento come lo vede la cascata; si sposta come chiedono
/// le operazioni.
class Node implements CascadeNode {
  parent: Node | null = null;
  children: Node[] = [];
  /// Il pezzo del modello di cui è la cima: un contenitore o un'unità.
  part: ElementPart | null = null;
  /// L'unità che lo contiene, lui compreso; `null` per un contenitore.
  unit: Node | null = null;
  /// Vero se sta in un'unità estranea.
  foreign = false;
  /// L'elemento letto, coi punti del testo da riscrivere.
  element: ElementNode | null = null;
  readonly serial = serials++;

  constructor(
    readonly uri: string,
    readonly local: string,
    public attrs: StyleAttr[],
    public text: boolean,
    /// Il foglio, per un `style` che ne porta uno.
    readonly sheet: string | null,
  ) {}

  id(): string | null {
    return this.attr("id");
  }

  attr(local: string): string | null {
    return this.attrs.find((attr) => attr.uri === "" && attr.local === local)?.value ?? null;
  }

  setAttr(local: string, value: string | null): void {
    this.attrs = this.attrs.filter((attr) => !(attr.uri === "" && attr.local === local));
    if (value !== null) this.attrs.push({ uri: "", local, value });
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
    node.element = element;
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

/// Lega gli elementi di `root` ai pezzi di `model`; falso se non si
/// corrispondono.
function annotate(root: Node, model: DocumentModel): boolean {
  const stack: Array<[ElementPart, Node]> = [[model.root, root]];
  while (stack.length > 0) {
    const [part, node] = stack.pop()!;
    if (part.facts.local !== node.local || part.facts.uri !== node.uri) return false;
    node.part = part;
    if (part.kind === "container") {
      const children = elementChildren(part);
      if (children.length !== node.children.length) return false;
      children.forEach((child, at) => stack.push([child, node.children[at]!]));
    } else {
      for (const inner of walk(node)) {
        inner.unit = node;
        inner.foreign = part.details === null;
      }
    }
  }
  return true;
}

/// Una copia di `root`; per ogni elemento della copia il suo originale, e
/// per ogni originale la sua copia.
function cloneTree(root: Node): [Node, Map<Node, Node>, Map<Node, Node>] {
  const original = new Map<Node, Node>();
  const copies = new Map<Node, Node>();
  const copy = (node: Node, parent: Node | null): Node => {
    const made = new Node(node.uri, node.local, [...node.attrs], node.text, node.sheet);
    made.parent = parent;
    made.part = node.part;
    made.foreign = node.foreign;
    made.element = node.element;
    original.set(made, node);
    copies.set(node, made);
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
  for (const [made, node] of original) made.unit = node.unit === null ? null : copies.get(node.unit)!;
  return [top, original, copies];
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
  /// Per un elemento, l'ultima operazione di primo livello che lo sposta.
  readonly moves = new Map<Node, number>();
  /// Gli elementi che cambiano posto o attributi.
  readonly moved = new Set<Node>();
  /// I nomi degli attributi che le operazioni scrivono.
  readonly names = new Set<string>();
  private readonly ids = new Map<string, Node>();

  constructor(private readonly root: Node) {
    for (const node of walk(root)) {
      const id = node.id();
      if (id !== null && !this.ids.has(id)) this.ids.set(id, node);
    }
  }

  /// Applica `op`, che è la numero `index` del comando, o una annidata se
  /// `index` è -1.
  apply(op: Op, index: number): void {
    switch (op.op) {
      case "batch":
        for (const inner of op.ops) this.apply(inner, -1);
        return;
      case "ident":
        this.setAttrs(this.byPath(op.path), { id: op.id });
        return;
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
        this.moved.add(node);
        if (index >= 0) this.moves.set(node, index);
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
      this.names.add(made.local);
      const id = made.uri === "" && made.local === "id" ? node.id() : undefined;
      node.attrs = node.attrs.filter((attr) => !(attr.uri === made.uri && attr.local === made.local));
      if (value !== null) node.attrs.push(made);
      if (id !== undefined) {
        if (id !== null && this.ids.get(id) === node) this.ids.delete(id);
        if (value !== null) this.ids.set(value, node);
      }
    }
    this.moved.add(node);
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

/// Un rifiuto che interrompe il calcolo.
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.kind);
  }
}

function refuse(refusal: Refusal): never {
  throw new Refused(refusal);
}

/// Il rifiuto per un dubbio.
const doubted = (doubt: Doubt): Refusal => ({ kind: doubt.kind, text: doubt.text });

/// Il percorso di `node` dalla radice.
function pathOf(node: Node): number[] {
  const path: number[] = [];
  for (let at = node; at.parent !== null; at = at.parent) path.push(at.parent.children.indexOf(at));
  return path.reverse();
}

/// Vero se `node`, o uno che lo contiene, è un elemento SVG fra `set`.
function within(node: Node, set: ReadonlySet<string>): boolean {
  for (let at: Node | null = node; at !== null; at = at.parent) if (at.uri === SVG_NS && set.has(at.local)) return true;
  return false;
}

/// Vero se `node` non si vede mai: sta in un titolo, in una descrizione, in
/// uno stile, o è un elemento di un altro vocabolario fuori da
/// `foreignObject`.
function silent(node: Node): boolean {
  let html = false;
  for (let at: Node | null = node; at !== null; at = at.parent) {
    if (at.uri !== SVG_NS) continue;
    if (SILENT.has(at.local)) return true;
    if (at.local === "foreignObject") html = true;
  }
  return node.uri !== SVG_NS && !html;
}

/// `text` come lo ammette l'attributo `p` di un oggetto `tag` del formato:
/// un colore in esadecimale, se serve; `null` se non lo ammette.
function editableText(tag: string, p: string, text: string): string | null {
  if (svgAttribute(tag as Tag, p, text)) return text;
  if (p !== "fill" && p !== "stroke") return null;
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (paint(lower) !== null) return lower;
  const named = NAMED_COLORS.get(lower);
  if (named !== undefined) return `#${named.toString(16).padStart(6, "0")}`;
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*(?:1|1\.0+|100%)\s*)?\)$/i.exec(trimmed);
  if (rgb === null) return null;
  const two = (n: string): string => Math.min(255, Number(n)).toString(16).padStart(2, "0");
  return `#${two(rgb[1]!)}${two(rgb[2]!)}${two(rgb[3]!)}`;
}

/// `value` scritto fra le virgolette `quote` di un attributo.
function escapeIn(value: string, quote: string): string {
  const escaped = escapeAttribute(value);
  return quote === "'" ? escaped.replace(/&quot;/g, '"').replace(/'/g, "&apos;") : escaped;
}

/// Una trasformazione scritta in CSS.
const cssMatrix = (m: Matrix): string => (same(m, IDENTITY) ? "none" : `matrix(${m.map((v) => formatNumber(v, PLACES)).join(", ")})`);

/// Il tratto del testo di un attributo, dagli spazi che lo precedono alla
/// virgoletta di chiusura.
function attributeSpan(text: string, attr: Attr): [number, number] {
  let i = attr.raw[0] - 2;
  while (isSpace(text.charCodeAt(i))) i--;
  i--;
  while (isSpace(text.charCodeAt(i))) i--;
  let from = i + 1 - attr.name.length;
  while (isSpace(text.charCodeAt(from - 1))) from--;
  return [from, attr.raw[1] + 1];
}

/// Le operazioni `ops`, applicate al disegno `text` letto in `model`, con ciò
/// che serve perché si veda com'era: vedi l'intestazione. Il rifiuto, se non
/// si sa.
export function keepLook(text: string, model: DocumentModel, ops: readonly Op[], keeping: Keeping): Kept | Refusal {
  if (plain(model)) return { ops, written: 0 };
  try {
    return new Keeper(text, model, ops, keeping).run();
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

/// Vero se il disegno è tutto nel formato: senza parti estranee, e quindi
/// senza fogli di stile, attributi `style` e copie collegate. Le operazioni
/// dei comandi portano già da sé la trasformazione, l'opacità e gli
/// attributi che si ereditano, gli unici che il formato ammette.
function plain(model: DocumentModel): boolean {
  const stack: ElementPart[] = [model.root];
  while (stack.length > 0) {
    const part = stack.pop()!;
    if (part.kind === "leaf") {
      if (part.details === null) return false;
    } else stack.push(...elementChildren(part));
  }
  return true;
}

/// Vero se `result` è un rifiuto.
export function refused(result: Kept | Refusal): result is Refusal {
  return "kind" in result;
}

class Keeper {
  private before!: Node;
  private after!: Node;
  private original!: Map<Node, Node>;
  private copies!: Map<Node, Node>;
  private follower!: Follower;
  private was!: Cascade;
  private work!: Cascade;
  private sheetAfter!: Sheet;
  private readonly inline = new Set<string>();
  private tracked: string[] = [];
  private readonly affected = new Set<Node>();
  /// Gli attributi di prima di ogni elemento su cui si è scritto.
  private readonly writes = new Map<Node, readonly StyleAttr[]>();
  /// Ciò che un `use` deve mostrare dopo, se l'elemento che mostra cambia.
  private readonly worlds = new Map<Node, World>();
  private readonly alphas = new Map<Node, Alpha>();
  private readonly needed = new Map<string, Map<Node, boolean>>();
  private readonly identity = (node: CascadeNode): string => String(this.original.get(node as Node)?.serial ?? (node as Node).serial);

  constructor(
    private readonly text: string,
    private readonly model: DocumentModel,
    private readonly ops: readonly Op[],
    private readonly keeping: Keeping,
  ) {}

  run(): Kept {
    let doc: XmlDocument;
    try {
      doc = parseXml(new SourceText(this.text), false);
    } catch {
      return refuse({ kind: "unknown" });
    }
    this.before = treeOf(doc);
    if (!annotate(this.before, this.model)) refuse({ kind: "unknown" });
    const order = walk(this.before);
    const styles = order.filter((node) => node.sheet !== null);
    const sheet = readSheets(styles.map((node) => ({ id: String(node.serial), css: node.sheet! })));
    for (const node of order) {
      const style = node.attr("style");
      if (style !== null) for (const declaration of readDeclarations(style)) for (const name of longhands(declaration.property)) this.inline.add(name);
    }

    [this.after, this.original, this.copies] = cloneTree(this.before);
    this.follower = new Follower(this.after);
    try {
      this.ops.forEach((op, index) => this.follower.apply(op, index));
    } catch (error) {
      if (!(error instanceof Unfollowed)) throw error;
      // Senza fogli e senza `style` lo stile segue gli elementi da sé.
      if (sheet.rules.length === 0 && this.inline.size === 0) return { ops: this.ops, written: 0 };
      refuse({ kind: "unknown" });
    }
    if (sheet.imports.some((url) => !FONT_SERVICES.test(url))) refuse({ kind: "import" });

    const later = walk(this.after).filter((node) => node.sheet !== null);
    this.sheetAfter = readSheets(later.map((node) => ({ id: String(this.original.get(node)!.serial), css: node.sheet! })));
    const reordered = later.length !== styles.length || later.some((node, at) => this.original.get(node) !== styles[at]);

    this.tracked = this.trackedOf(sheet, order);
    this.was = new Cascade(sheet, this.before, this.identity, this.inline);
    this.work = new Cascade(this.sheetAfter, this.after, this.identity, this.inline);

    // Dove guardare: dove le operazioni cambiano i fratelli, se un foglio
    // sceglie per posizione, o solo ciò che si sposta; tutto, se il foglio
    // guarda dentro, se cambia l'ordine dei fogli o se sceglie per un
    // attributo che si scrive.
    const watched = new Set<string>();
    for (const selector of sheet.selectors) attributeNames(selector, watched);
    const writable = ["style", "transform", "opacity", "id", ...this.tracked, ...this.follower.names];
    const whole = sheet.deep || reordered || writable.some((name) => watched.has(name));
    const changed = sheet.rules.length > 0 ? this.follower.touched : this.follower.moved;
    const places = whole ? [this.after] : [...changed].filter((place) => !this.follower.removed.has(place));
    for (const place of places) for (const node of walk(place)) this.affected.add(node);

    this.containers();
    this.pass(true, this.work);
    this.copiesPass(true);
    const emitted = this.emit();
    this.verify();
    return { ops: emitted, written: [...this.writes.keys()].filter((node) => this.changed(node).length > 0).length };
  }

  /// Le proprietà da confrontare: quelle dei fogli e degli attributi
  /// `style`, e quelle ereditate scritte come attributi.
  private trackedOf(sheet: Sheet, order: readonly Node[]): string[] {
    const out = new Set<string>(this.inline);
    for (const rule of sheet.rules) for (const declaration of rule.declarations) for (const name of longhands(declaration.property)) out.add(name);
    for (const node of order) for (const attr of node.attrs) if (attr.uri === "" && INHERITED.has(attr.local)) out.add(attr.local);
    if (out.has("all")) for (const name of INHERITED) out.add(name);
    const keep = (name: string): boolean => !name.startsWith("--") && !IGNORED.has(name) && !ACCUMULATED.has(name) && !FIRST.includes(name) && name !== "all";
    return [...FIRST, ...[...out].filter(keep)];
  }

  /// I contenitori che se ne vanno e quelli che arrivano: un effetto che
  /// vale per tutto ciò che contengono non si può portare sui figli.
  private containers(): void {
    for (const gone of this.follower.removed) {
      if (gone.parent !== null) continue;
      const was = this.original.get(gone)!;
      if (silent(was)) continue;
      for (const effect of EFFECTS) {
        const value = this.was.value(was, effect);
        if (!effective(effect, value)) continue;
        refuse(value.doubt !== null ? doubted(value.doubt) : { kind: "lost", property: effect });
      }
    }
    for (const made of this.follower.added) {
      if (silent(made)) continue;
      for (const effect of [...EFFECTS, "opacity"]) {
        const value = this.work.value(made, effect);
        if (!effective(effect, value)) continue;
        refuse(value.doubt !== null ? doubted(value.doubt) : { kind: "new", property: effect });
      }
      const own = this.work.own(made);
      if (own.m === null || !same(own.m, IDENTITY)) refuse({ kind: "new", property: "transform" });
    }
  }

  /// Confronta gli elementi da guardare con com'erano, dall'alto: con `fix`
  /// scrive ciò che serve, senza rifiuta alla prima differenza.
  private pass(fix: boolean, cascade: Cascade): void {
    for (const node of walk(this.after)) {
      if (this.affected.has(node) && !this.follower.added.has(node) && !silent(node)) this.compare(node, fix, cascade);
    }
  }

  /// Confronta `node` con com'era.
  private compare(node: Node, fix: boolean, cascade: Cascade): void {
    const was = this.original.get(node)!;
    const placed = !within(node, RESOURCES);
    if (node.uri === SVG_NS && placed) {
      const before = this.worlds.get(node) ?? this.was.world(was);
      if (!sameWorld(before, cascade.world(node))) {
        if (!fix) refuse({ kind: "object", property: "transform" });
        this.fixWorld(node, before);
      }
    }
    if (placed && this.keeping.containers === "keep") {
      const before = this.alphas.get(node) ?? this.was.alpha(was);
      if (!sameAlpha(before, cascade.alpha(node))) {
        if (!fix) refuse({ kind: "object", property: "opacity" });
        this.fixAlpha(node, before);
      }
    } else if (placed) {
      const before = this.was.value(was, "opacity");
      if (before.key !== cascade.value(node, "opacity").key) {
        if (!fix) refuse(before.doubt !== null ? doubted(before.doubt) : { kind: "object", property: "opacity" });
        this.fixValue(node, "opacity", before);
      }
    }
    for (const p of this.tracked) {
      if (!this.needs(node, p, cascade)) continue;
      const before = this.was.value(was, p);
      // Chi cambia contenitore ne prende la visibilità.
      if (p === "visibility" && this.keeping.containers === "take" && !before.own) continue;
      const now = cascade.value(node, p);
      if (before.key === now.key) continue;
      if (!fix) {
        // Un contenitore lascia ai figli ciò che ereditano: si guardano loro.
        if (inherits(p) && !renders(node, p)) continue;
        refuse(before.doubt !== null ? doubted(before.doubt) : now.doubt !== null ? doubted(now.doubt) : { kind: "object", property: p });
      }
      this.fixValue(node, p, before);
    }
  }

  /// Vero se il valore di `p` su `node` si vede: su di lui, o su un figlio
  /// che lo eredita.
  private needs(node: Node, p: string, cascade: Cascade): boolean {
    let memo = this.needed.get(p);
    if (memo === undefined) this.needed.set(p, (memo = new Map()));
    const known = memo.get(node);
    if (known !== undefined) return known;
    // Dal basso, con la pila: prima i figli.
    const stack: Array<[Node, boolean]> = [[node, false]];
    while (stack.length > 0) {
      const [at, ready] = stack.pop()!;
      if (memo.has(at)) continue;
      const shown = !silent(at) && renders(at, p);
      if (!ready && !shown && inherits(p)) {
        stack.push([at, true]);
        for (const child of at.children) if (!memo.has(child)) stack.push([child, false]);
        continue;
      }
      memo.set(at, shown || (inherits(p) && !silent(at) && at.children.some((child) => memo.get(child) === true && !cascade.value(child, p).own)));
    }
    return memo.get(node)!;
  }

  /// Come si scrive su `node`: con `set` su un oggetto, riscrivendo un
  /// elemento di un altro programma, o non si può.
  private kind(node: Node): "set" | "raw" | null {
    if (this.follower.added.has(node)) return null;
    const was = this.original.get(node)!;
    if (was.part !== null && was.part.details !== null) return "set";
    if (was.unit !== null && was.foreign) return "raw";
    return null;
  }

  /// Gli attributi di `node` che si sono scritti: il nome e il valore,
  /// `null` se tolto.
  private changed(node: Node): Array<[string, string | null]> {
    const before = this.writes.get(node);
    if (before === undefined) return [];
    const out: Array<[string, string | null]> = [];
    for (const attr of node.attrs) {
      if (attr.uri !== "" || attr.local === "id") continue;
      if (before.find((each) => each.uri === "" && each.local === attr.local)?.value !== attr.value) out.push([attr.local, attr.value]);
    }
    for (const attr of before) if (attr.uri === "" && attr.local !== "id" && node.attr(attr.local) === null) out.push([attr.local, null]);
    return out;
  }

  /// Scrive `p` su `node` nella forma più leggera che basta perché `check`
  /// dica di sì: attributo, `style`, `style` importante. `attr` è il valore
  /// come attributo, `null` se non si scrive così; `css` come proprietà.
  private tryWrite(node: Node, p: string, attr: string | null, css: string, check: () => boolean): boolean {
    const kind = this.kind(node);
    if (kind === null) return false;
    const saved = [...node.attrs];
    const fresh = !this.writes.has(node);
    if (fresh) this.writes.set(node, saved);
    const attempt = (change: () => void): boolean => {
      change();
      this.work.forget(node);
      if (check()) return true;
      node.attrs = [...saved];
      this.work.forget(node);
      return false;
    };
    let done = false;
    if (kind === "set") {
      const value = attr === null ? null : editableText(node.local, p, attr);
      done = value !== null && attempt(() => node.setAttr(p, value));
    } else {
      done = attr !== null && node.uri === SVG_NS && !this.work.styled(node, p) && attempt(() => node.setAttr(p, attr));
      const style = node.attr("style") ?? "";
      const glue = style.trim() === "" || style.trim().endsWith(";") ? "" : ";";
      done ||= attempt(() => node.setAttr("style", `${style}${glue}${p}:${css}`));
      done ||= attempt(() => node.setAttr("style", `${style}${glue}${p}:${css} !important`));
    }
    if (!done && fresh) this.writes.delete(node);
    if (done) this.forgetNeeds(node);
    return done;
  }

  /// Scrive `p` su `node` perché valga `want`, o rifiuta.
  private fixValue(node: Node, p: string, want: Value): void {
    if (want.doubt !== null) refuse(doubted(want.doubt));
    const check = (): boolean => this.work.value(node, p).key === want.key;
    if (want.text !== null && this.tryWrite(node, p, want.attr ? want.text : null, want.text, check)) return;
    // Un contenitore che non lo prende lo lascia ai figli, che lo ereditano.
    if (inherits(p) && !renders(node, p)) return;
    const now = this.work.value(node, p);
    refuse(now.doubt !== null ? doubted(now.doubt) : { kind: "object", property: p });
  }

  /// Porta la trasformazione accumulata di `node` a `want`, o rifiuta.
  private fixWorld(node: Node, want: World): void {
    const parent = node.parent === null ? { m: IDENTITY, sym: "" } : this.work.world(node.parent);
    const inverse = invert(parent.m);
    if (parent.sym !== want.sym || inverse === null) refuse({ kind: "object", property: "transform" });
    const own = compose(inverse, want.m);
    const check = (): boolean => sameWorld(this.work.world(node), want);
    // Senza trasformazione, prima si prova a togliere quella che c'è.
    const identity = same(own, IDENTITY);
    if (identity && node.attr("transform") !== null && this.tryRemove(node, "transform", check)) return;
    if (!this.tryWrite(node, "transform", this.work.own(node).css ? null : formatTransform(own), cssMatrix(own), check)) refuse({ kind: "object", property: "transform" });
  }

  /// Toglie l'attributo `name` da `node`, se basta perché `check` dica di sì.
  private tryRemove(node: Node, name: string, check: () => boolean): boolean {
    if (this.kind(node) === null) return false;
    const saved = [...node.attrs];
    const fresh = !this.writes.has(node);
    if (fresh) this.writes.set(node, saved);
    node.setAttr(name, null);
    this.work.forget(node);
    if (check()) {
      this.forgetNeeds(node);
      return true;
    }
    node.attrs = saved;
    this.work.forget(node);
    if (fresh) this.writes.delete(node);
    return false;
  }

  /// Porta l'opacità accumulata di `node` a `want`, o rifiuta.
  private fixAlpha(node: Node, want: Alpha): void {
    const parent = node.parent === null ? { a: 1, sym: "" } : this.work.alpha(node.parent);
    if (parent.sym !== want.sym) refuse({ kind: "object", property: "opacity" });
    let own = parent.a === 0 ? 1 : want.a / parent.a;
    if (own > 1 + 1e-3) refuse({ kind: "object", property: "opacity" });
    own = Math.min(1, own);
    const text = formatNumber(own, PLACES);
    const check = (): boolean => sameAlpha(this.work.alpha(node), want);
    if (!this.tryWrite(node, "opacity", text, text, check)) refuse({ kind: "object", property: "opacity" });
  }

  /// Dopo una scrittura su `node`, ciò che serve a lui e ai suoi figli si
  /// ricalcola.
  private forgetNeeds(node: Node): void {
    const inner = walk(node);
    for (const memo of this.needed.values()) for (const each of inner) memo.delete(each);
  }

  /// Le copie collegate: un `use` che mostra un elemento a cui cambia la
  /// trasformazione o l'opacità le compensa su di sé; se all'elemento
  /// cambia altro, o se ne va, il comando non si fa.
  private copiesPass(fix: boolean): void {
    const ids = new Map<string, Node>();
    for (const node of walk(this.before)) {
      const id = node.id();
      if (id !== null && !ids.has(id)) ids.set(id, node);
    }
    for (const use of walk(this.after)) {
      if (use.uri !== SVG_NS || use.local !== "use" || this.follower.added.has(use) || silent(use)) continue;
      const href = use.attr("href") ?? use.attrs.find((attr) => attr.uri === XLINK_NS && attr.local === "href")?.value ?? "";
      const shown0 = href.startsWith("#") ? ids.get(href.slice(1)) : undefined;
      if (shown0 === undefined) continue;
      const shown = this.copies.get(shown0)!;
      if (this.follower.removed.has(shown)) refuse({ kind: "copy" });
      const inside = walk(shown);
      if (inside.includes(use)) continue;
      // Ciò che la copia eredita viene dal `use`: un attributo scritto
      // dentro l'elemento la cambierebbe.
      for (const node of inside) {
        const was = this.original.get(node);
        if (was === undefined) refuse({ kind: "copy" });
        const differs = (local: string): boolean => (was.attr(local) ?? null) !== node.attr(local);
        const names = new Set([...was.attrs, ...node.attrs].filter((attr) => attr.uri === "" && attr.local !== "id").map((attr) => attr.local));
        for (const name of names) if (differs(name) && !(node === shown && (name === "transform" || name === "opacity"))) refuse({ kind: "copy" });
      }
      if (!this.affected.has(use) && !inside.some((node) => this.affected.has(node) || this.writes.has(node))) continue;
      const use0 = this.original.get(use)!;
      const offset = (node: Node): Matrix => {
        const x = svgLength(node.attr("x") ?? "0");
        const y = svgLength(node.attr("y") ?? "0");
        if (x === null || y === null) refuse({ kind: "copy" });
        return [1, 0, 0, 1, x, y];
      };
      const own0 = this.was.own(shown0);
      const own1 = this.work.own(shown);
      if (own0.m === null || own1.m === null) {
        if (own0.m !== own1.m || own0.text !== own1.text) refuse({ kind: "copy" });
      } else {
        const world0 = this.was.world(use0);
        const before = compose(world0.m, compose(offset(use0), own0.m));
        const world1 = this.work.world(use);
        const now = compose(world1.m, compose(offset(use), own1.m));
        if (world0.sym !== world1.sym) refuse({ kind: "copy" });
        if (!same(before, now)) {
          if (!fix) refuse({ kind: "copy" });
          const inner = invert(compose(offset(use), own1.m));
          if (inner === null) refuse({ kind: "copy" });
          const want: World = { m: compose(before, inner), sym: world0.sym };
          this.worlds.set(use, want);
          this.guarded(() => this.fixWorld(use, want));
        }
      }
      const fade0 = this.was.opacity(shown0);
      const fade1 = this.work.opacity(shown);
      if (fade0 === null || fade1 === null) {
        if (this.was.value(shown0, "opacity").key !== this.work.value(shown, "opacity").key) refuse({ kind: "copy" });
        continue;
      }
      const alpha0 = this.was.alpha(use0);
      const alpha1 = this.work.alpha(use);
      if (Math.abs(alpha0.a * fade0 - alpha1.a * fade1) > 1e-3) {
        if (!fix || fade1 === 0) refuse({ kind: "copy" });
        const want: Alpha = { a: (alpha0.a * fade0) / fade1, sym: alpha0.sym };
        this.alphas.set(use, want);
        this.guarded(() => this.fixAlpha(use, want));
      }
    }
  }

  /// `write`, con il rifiuto di una copia collegata se non riesce.
  private guarded(write: () => void): void {
    try {
      write();
    } catch (error) {
      if (error instanceof Refused) refuse({ kind: "copy" });
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Le operazioni.
  // -------------------------------------------------------------------------

  /// Le operazioni del comando con ciò che si è scritto.
  private emit(): Op[] {
    const present = new Set<string>();
    for (const node of walk(this.after)) {
      const id = node.id();
      if (id !== null) present.add(id);
    }
    // Gli id nuovi, diversi da quelli del documento e fra loro.
    const fresh = new Set<string>();
    const nextId = (kind: IdKind): string => {
      const id = createId(kind, (candidate) => fresh.has(candidate) || present.has(candidate) || this.keeping.taken(candidate));
      fresh.add(id);
      return id;
    };
    const units = new Map<Node, Node[]>();
    const sets: Node[] = [];
    for (const node of this.writes.keys()) {
      if (this.changed(node).length === 0) continue;
      if (this.kind(node) === "set") {
        sets.push(node);
        continue;
      }
      const unit = node.unit!;
      let list = units.get(unit);
      if (list === undefined) units.set(unit, (list = []));
      list.push(node);
    }
    // Una parte estranea che con gli attributi nuovi rientrerebbe nel
    // formato diventerebbe un oggetto senza id: lo stile va in `style`.
    const raws = new Map<Node, string>();
    for (const [unit, nodes] of units) {
      let raw = this.rewrite(unit, nodes);
      if (this.editable(unit, raw)) {
        this.restyle(unit);
        if (!nodes.includes(unit)) nodes.push(unit);
        raw = this.rewrite(unit, nodes);
        if (this.editable(unit, raw)) refuse({ kind: "unknown" });
      }
      raws.set(unit, raw);
    }

    const out: Op[] = [];
    const replaced = new Map<number, Node>();
    const inPlace: Node[] = [];
    for (const unit of raws.keys()) {
      const index = this.follower.moves.get(unit);
      if (index !== undefined) replaced.set(index, unit);
      else inPlace.push(unit);
    }
    this.ops.forEach((op, index) => {
      const unit = replaced.get(index);
      if (unit === undefined || op.op !== "move" || !("parent" in op)) {
        out.push(op);
        return;
      }
      // Tolta e rimessa riscritta dove andava.
      out.push({ op: "remove", target: op.target });
      out.push({ op: "add", parent: op.parent, pos: op.pos, raw: raws.get(unit)! });
    });

    const idents: Op[] = [];
    const named = (node: Node): string => {
      const id = node.id();
      if (id !== null) return id;
      const made = nextId(node.parent?.parent === null && node.local === "g" ? "layer" : "object");
      idents.push({ op: "ident", path: pathOf(node), tag: node.local, id: made });
      node.setAttr("id", made);
      present.add(made);
      return made;
    };
    const changes: Op[] = [];
    for (const node of sets) changes.push({ op: "set", id: named(node), attrs: Object.fromEntries(this.changed(node)) });
    const runs = this.runs(inPlace, raws, named);
    return [...out, ...idents, ...changes, ...runs];
  }

  /// Vero se `raw`, l'unità estranea `unit` riscritta, rientrerebbe nel
  /// formato.
  private editable(unit: Node, raw: string): boolean {
    const part = this.original.get(unit)!.part as LeafNode;
    const fragment = parseFragment(raw, scopeOf(part.parent!));
    if (fragment === null) refuse({ kind: "unknown" });
    return buildFragment(fragment, part.parent!).details !== null;
  }

  /// Gli attributi scritti sulla cima di `unit` passano in `style`.
  private restyle(unit: Node): void {
    const before = this.writes.get(unit) ?? [];
    const moved: string[] = [];
    for (const [name, value] of this.changed(unit)) {
      if (name === "style" || value === null) continue;
      moved.push(`${name}:${name === "transform" ? cssMatrix(this.work.own(unit).m ?? IDENTITY) : value}`);
      unit.setAttr(name, before.find((attr) => attr.uri === "" && attr.local === name)?.value ?? null);
    }
    if (moved.length === 0) return;
    if (!this.writes.has(unit)) this.writes.set(unit, [...unit.attrs]);
    const style = unit.attr("style") ?? "";
    const glue = style.trim() === "" || style.trim().endsWith(";") ? "" : ";";
    unit.setAttr("style", `${style}${glue}${moved.join(";")}`);
    this.work.forget(unit);
  }

  /// Il testo dell'unità estranea `unit` con gli attributi scritti su
  /// `nodes`, che stanno dentro di lei.
  private rewrite(unit: Node, nodes: readonly Node[]): string {
    const was = this.original.get(unit)!;
    const part = was.part as LeafNode;
    const top = was.element!;
    if (this.text.slice(top.start, top.end) !== part.raw) refuse({ kind: "unknown" });
    const edits: Array<[from: number, to: number, text: string]> = [];
    for (const node of nodes) {
      const element = this.original.get(node)!.element!;
      const before = this.writes.get(node) ?? [];
      let last = element.start + 1 + element.name.length;
      for (const attr of element.attrs) last = Math.max(last, attr.raw[1] + 1);
      let additions = "";
      for (const [name, value] of this.changed(node)) {
        const written = element.attrs.find((attr) => attr.ns === 0 && attr.local === name);
        if (value === null) {
          if (written !== undefined) edits.push([...attributeSpan(this.text, written), ""]);
          continue;
        }
        if (written === undefined) {
          additions += ` ${name}="${escapeIn(value, '"')}"`;
          continue;
        }
        const quote = this.text[written.raw[0] - 1]!;
        const old = before.find((attr) => attr.uri === "" && attr.local === name)?.value;
        if (name === "style" && old !== undefined && value.startsWith(old)) edits.push([written.raw[1], written.raw[1], escapeIn(value.slice(old.length), quote)]);
        else edits.push([written.raw[0], written.raw[1], escapeIn(value, quote)]);
      }
      if (additions !== "") edits.push([last, last, additions]);
    }
    edits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let out = "";
    let at = top.start;
    for (const [from, to, text] of edits) {
      out += this.text.slice(at, from) + text;
      at = to;
    }
    return out + this.text.slice(at, top.end);
  }

  /// Le unità estranee `units` che restano dove sono, riscritte al loro
  /// posto: con le sorelle estranee senza id che le precedono fino a una che
  /// un'operazione sa nominare, tolte e rimesse in una volta.
  private runs(units: readonly Node[], raws: ReadonlyMap<Node, string>, named: (node: Node) => string): Op[] {
    const out: Op[] = [];
    const byParent = new Map<Node, Set<number>>();
    for (const unit of units) {
      const parent = unit.parent!;
      let set = byParent.get(parent);
      if (set === undefined) byParent.set(parent, (set = new Set()));
      set.add(parent.children.indexOf(unit));
    }
    const anchor = (node: Node): boolean => node.id() !== null || this.kind(node) === "set" || this.follower.added.has(node);
    const rawOf = (node: Node): string => {
      const written = raws.get(node);
      if (written !== undefined) return written;
      const part = this.original.get(node)?.part;
      if (part === undefined || part === null || part.kind !== "leaf") return refuse({ kind: "unknown" });
      return part.raw;
    };
    for (const [parent, indices] of byParent) {
      // Per ogni sorella che si sa nominare, l'ultima da riscrivere dopo di
      // lei; -1 per l'inizio.
      const groups = new Map<number, number>();
      for (const index of indices) {
        let at = index - 1;
        while (at >= 0 && !anchor(parent.children[at]!)) at--;
        groups.set(at, Math.max(groups.get(at) ?? -1, index));
      }
      const container = parent.parent === null ? ROOT : named(parent);
      const base = pathOf(parent);
      for (const [at, end] of groups) {
        const run = parent.children.slice(at + 1, end + 1);
        const pos: Pos = at < 0 ? { first: true } : { after: named(parent.children[at]!) };
        for (let k = run.length - 1; k >= 0; k--) {
          const node = run[k]!;
          out.push({ op: "remove", target: { path: [...base, at + 1 + k], tag: tagName(this.original.get(node)!.part!) } });
        }
        const indent = indentOf(this.model, this.original.get(run[0]!)!.part!);
        out.push({ op: "add", parent: container, pos, raw: run.map(rawOf).join(`\n${indent}`) });
      }
    }
    return out;
  }

  /// Lo stile di dopo, ricalcolato da capo con ciò che si è scritto, è quello
  /// di prima; se no rifiuta.
  private verify(): void {
    this.work = new Cascade(this.sheetAfter, this.after, this.identity, this.inline);
    this.needed.clear();
    this.pass(false, this.work);
    this.copiesPass(false);
  }
}

/// Vero se un effetto di un contenitore fa qualcosa.
function effective(effect: string, value: Value): boolean {
  if (value.doubt !== null) return true;
  switch (effect) {
    case "display":
      return value.key === "none";
    case "opacity":
      return value.text === null || readOpacity(value.text) !== 1;
    case "isolation":
      return value.key !== "auto" && value.key !== "initial";
    case "mix-blend-mode":
      return value.key !== "normal" && value.key !== "initial";
    default:
      return value.key !== "none" && value.key !== "initial";
  }
}
