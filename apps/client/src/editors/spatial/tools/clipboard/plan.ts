// Gli appunti dei disegni, incollare: il piano dell'incolla, un `batch` solo,
// e come si scrive ciascun elemento che entra (`../clipboard.ts`).

import { isContainer } from "../../scene/analysis";
import { classifyChild, firstTitle, svgAttribute, type Place } from "../../scene/classify";
import { reindent } from "../../scene/engine";
import { compose, IDENTITY } from "../../scene/matrix";
import { elementChildren, indentOf, parseFragment, placeOf, scopeOf, type ContainerNode, type DocumentModel } from "../../scene/model";
import type { Op } from "../../scene/ops";
import { attributesOf, canonicalOrder, escapeAttribute, escapeText, formatTransform, NamespaceScope, scopeInside, writeOpenTag, type OutAttr } from "../../scene/serialize";
import { transform as parseTransform } from "../../scene/values";
import { isSvg, NS_FUB, NS_NONE, NS_XML, valueOf, XMLNS_URI, type Attr, type ElementNode, type NodeId } from "../../scene/xml";
import { INHERITED, plainAttributes } from "../arrange";
import { mappedBounds, transformValue } from "../edit";
import { INITIAL } from "../place";
import { homeOf, resourceHome } from "../resources";
import { ancestors, CHUNK_BYTES, inheritedOf, isIdentity, needed, renders, rolesUnder, ROOT_ONLY, scopeOfChain, snapped, subtree } from "./base";
import { lf, Rewriter } from "./rewriter";
import { fromPx, jsonBytes, type PastePlan, type PasteSource, type PasteTarget } from "./read";
import { Adds, liftOf } from "./lift";

/// I passi dell'incolla di `source` in `target`. Rende la parte fatta, fra 0
/// e 1, di tanto in tanto fra un elemento e l'altro, così l'editor può
/// mostrarla e lasciar respirare la pagina; alla fine, il piano.
export function* planPaste(source: PasteSource, target: PasteTarget): Generator<number, PastePlan> {
  const { doc } = source;
  const { model, container, ids } = target;
  const root = doc.element(doc.root)!;
  const total = Math.max(1, doc.source.text.length);
  let done = 0;
  /// La parte fatta fino a `at`, se è cresciuta almeno di un centesimo.
  const progress = (at: number): number | null => {
    if (at - done < total / 100) return null;
    done = at;
    return done / total;
  };
  // Dalle coordinate dell'SVG alla scena: la misura vera resta, e fra unità
  // uguali è una traslazione.
  const px = fromPx(model, target.delta);
  const content = snapped(compose(target.to.inverse, snapped(compose(px, source.toPx))));
  const bounds = mappedBounds(source.frame, px);
  const scope = scopeOf(container);
  const siblings = elementChildren(container);
  const indent = siblings.length > 0 ? indentOf(model, siblings[siblings.length - 1]!) : `${indentOf(model, container)}  `;
  const place = placeOf(container);
  const depth = container.depth + 1;
  // Gli attributi che il contenitore e i suoi antenati scrivono: chi entra e
  // prendeva un attributo ereditato dal suo valore di partenza lo scrive.
  const passed = new Set<string>();
  for (let at: ContainerNode | null = container; at !== null; at = at.parent) for (const name of plainAttributes(at).keys()) passed.add(name);
  const initial = (element: ElementNode, names: readonly string[], set: Map<string, string | null>): void => {
    for (const name of names) {
      if (!passed.has(name) || valueOf(element, NS_NONE, name) !== undefined || set.has(name)) continue;
      const value = INITIAL[name];
      if (value !== undefined) set.set(name, value);
    }
  };

  // Gli id nuovi, uno per elemento; un riferimento va al primo elemento con
  // quell'id, come in un browser. La radice di un SVG che entra in un gruppo
  // è il gruppo che porta i suoi attributi.
  const wrap = source.pieces.length === 0;
  const tops = wrap ? root.children.filter((child) => doc.element(child) !== null && !source.dropped.has(child)) : source.pieces;
  const inner = wrap ? innerAttributes(root) : [];
  const group = wrap ? ids.next("object") : null;
  const sheetScope = inner.length > 0 ? ids.next("object") : group;
  const renamed = new Map<NodeId, string>();
  const names = new Map<string, string>();
  const rootId = valueOf(root, NS_NONE, "id") ?? "";
  if (wrap && rootId !== "") names.set(rootId, sheetScope!);
  // Dentro un gruppo che resta estraneo non si cercano modificabili, e
  // allora nemmeno risorse.
  const refill = target.refill;
  const lift = liftOf(doc, tops, inner.length === 0, model, ids, names, renamed, refill);
  for (const top of tops) {
    for (const at of subtree(doc, top)) {
      if (lift.decided.has(at)) continue;
      const value = valueOf(doc.element(at)!, NS_NONE, "id") ?? "";
      if (value === "") continue;
      const id = ids.next("object");
      renamed.set(at, id);
      if (!names.has(value)) names.set(value, id);
    }
  }
  const rewriter = new Rewriter(doc, {
    rename: (id) => names.get(id) ?? null,
    relink: true,
    ids: renamed,
    named: lift.named,
    colors: lift.colors,
    styled: lift.styled,
    sheets: wrap ? sheetScope : null,
    href: target.href,
    resolve: lift.resolve,
    written: lift.written,
  });
  const sourceScope = scopeInside(NamespaceScope.EMPTY, root);
  const ops: Op[] = [...target.to.prelude];
  const adds = new Adds(ops);

  // Le risorse prima di chi le usa, in fondo alla `defs` del disegno.
  if (lift.moved.length > 0) {
    const home = homeOf(model);
    for (const op of home.prelude) adds.then(op);
    const there = resourceHome(model);
    const homeScope = scopeOf(there ?? model.root);
    const children = there === null ? [] : elementChildren(there);
    const first = elementChildren(model.root)[0];
    const outer = there !== null ? indentOf(model, there) : first !== undefined ? indentOf(model, first) : "";
    const homeIndent = children.length > 0 ? indentOf(model, children[children.length - 1]!) : `${outer}  `;
    for (const child of lift.moved) {
      const element = doc.element(child)!;
      const from = doc.source.indent(element.start);
      if (refill !== undefined && rewriter.idOf(child) === refill.into.facts.id) {
        refillWith(rewriter, adds, child, refill.into, model);
        const step = progress(element.end);
        if (step !== null) yield step;
        continue;
      }
      rewriter.used.clear();
      rewriter.body(child, true);
      const declarations = needed(scopeOfChain(ancestors(doc, child)), homeScope, rewriter.used, element);
      rewriter.head(child, { set: new Map(), before: null, canonical: false, unlayer: false, declarations, id: null, child: null }, from);
      for (const at of element.children) {
        const name = lift.titled.get(at);
        const title = doc.element(at);
        if (name !== undefined && title !== null && title.closeStart !== null) rewriter.edits.add(title.openEnd, title.closeStart, escapeText(name));
      }
      // Un simbolo troppo grande per un'operazione entra a pezzi, come un
      // gruppo.
      emit(rewriter, adds, child, home.parent, rewriter.idOf(child), from, homeIndent, homeScope, "defs", 2);
      const step = progress(element.end);
      if (step !== null) yield step;
    }
    adds.flush();
  }
  if (refill !== undefined) return { ops, keys: [], bounds, symbols: lift.symbols };

  if (!wrap) {
    const keys: string[] = [];
    const tag = sourceScope.svgName("title") ?? "title";
    for (const piece of source.pieces) {
      if (lift.defs.has(piece)) continue;
      const element = doc.element(piece)!;
      const missing: NodeId[] = [];
      const found = rolesUnder(doc, piece, "inside", depth, false, missing, lift.resolve);
      for (const at of missing) rewriter.fresh.set(at, ids.next("object"));
      const layer = found !== null && isSvg(element, "g") && valueOf(element, NS_FUB, "layer") !== undefined;
      const set = new Map<string, string | null>();
      let before: string | null = null;
      if (!isIdentity(content)) {
        const own = parseTransform(valueOf(element, NS_NONE, "transform") ?? "") ?? IDENTITY;
        if (found !== null) set.set("transform", transformValue(compose(content, own)));
        else if (renders(element)) before = formatTransform(content);
      }
      initial(element, inheritedOf(element, found), set);
      // Ciò che si vede riceve un id, per sceglierlo dopo.
      const given = renamed.has(piece) || !renders(element) ? null : ids.next("object");
      const title = layer && firstTitle(doc, element) === null ? valueOf(element, NS_FUB, "layer")! : "";
      const from = doc.source.indent(element.start);
      rewriter.used.clear();
      rewriter.body(piece, true);
      rewriter.head(
        piece,
        {
          set,
          before,
          canonical: found !== null && (set.size > 0 || layer),
          unlayer: layer,
          declarations: needed(sourceScope, scope, rewriter.used, element),
          id: given,
          child: title === "" ? null : `<${tag}>${escapeText(title)}</${tag}>`,
        },
        from,
      );
      const key = given ?? renamed.get(piece) ?? null;
      if (key !== null && renders(element)) keys.push(key);
      emit(rewriter, adds, piece, target.to.parent, key, from, indent, scope, place, depth);
      const step = progress(element.end);
      if (step !== null) yield step;
    }
    adds.flush();
    return { ops, keys, bounds, symbols: lift.symbols };
  }

  // Un SVG che entra in un gruppo nuovo: il gruppo prende gli attributi
  // della radice che il formato gli ammette e la trasformazione dalla sua
  // misura; gli altri vanno su un gruppo dentro, che resta estraneo, e
  // allora dentro non si cercano modificabili. Lo spazio prima di ciò che
  // resta fuori va via con lui; un livello di un SVG di FubDraw diventa un
  // gruppo, come quando rientra da solo.
  const g = scope.svgName("g") ?? "g";
  const tag = scope.svgName("title") ?? "title";
  const layerTag = sourceScope.svgName("title") ?? "title";
  const parts: Array<{ readonly id: NodeId | null; readonly text: string }> = [];
  const missing: NodeId[] = [];
  let blank = -1;
  for (const child of root.children) {
    const node = doc.nodes[child]!;
    if (source.dropped.has(child) || lift.defs.has(child)) {
      if (blank >= 0) parts.splice(blank, 1);
      blank = -1;
      continue;
    }
    if (node.kind === "text" && node.blank) {
      blank = parts.length;
      parts.push({ id: null, text: lf(doc.source.text.slice(node.start, node.end)) });
      continue;
    }
    blank = -1;
    if (node.kind === "element") {
      const found = inner.length === 0 ? rolesUnder(doc, child, "inside", depth + 1, true, missing, lift.resolve) : null;
      for (const at of missing) rewriter.fresh.set(at, ids.next("object"));
      missing.length = 0;
      const layer = source.fubdraw && found !== null && isSvg(node, "g") && valueOf(node, NS_FUB, "layer") !== undefined;
      rewriter.body(child, layer);
      if (layer) {
        const title = firstTitle(doc, node) === null ? `<${layerTag}>${escapeText(valueOf(node, NS_FUB, "layer")!)}</${layerTag}>` : null;
        const fresh = rewriter.fresh.get(child) ?? null;
        rewriter.head(child, { set: new Map(), before: null, canonical: true, unlayer: true, declarations: [], id: fresh, child: title }, doc.source.indent(node.start));
      }
      parts.push({ id: child, text: rewriter.slice(node.start, node.end) });
      const step = progress(node.end);
      if (step !== null) yield step;
    } else if (node.kind === "entity-ref") {
      parts.push({ id: null, text: escapeText(doc.plainEntity(node.name)!) });
    } else {
      parts.push({ id: null, text: lf(doc.source.text.slice(node.start, node.end)) });
    }
  }

  const values = rewriter.values(doc.root);
  const written = attributesOf(doc, root);
  const textOf = (index: number): string => values.get(index) ?? written[index]!.text;
  const attrs: OutAttr[] = [{ name: "id", uri: "", local: "id", text: group! }];
  root.attrs.forEach((attr, index) => {
    if (attr.ns === NS_XML) attrs.push({ ...written[index]!, text: textOf(index) });
    else if (attr.ns === NS_NONE && admitted(attr)) attrs.push({ ...written[index]!, text: escapeAttribute(attr.value) });
  });
  const transform = transformValue(content);
  if (transform !== null) attrs.push({ name: "transform", uri: "", local: "transform", text: transform });
  const set = new Map<string, string | null>();
  initial(root, INHERITED, set);
  for (const [name, value] of set) attrs.push({ name, uri: "", local: name, text: escapeAttribute(value!) });
  for (const [prefix, uri] of needed(sourceScope, scope, rewriter.used, null)) {
    attrs.push({ name: prefix === null ? "xmlns" : `xmlns:${prefix}`, uri: XMLNS_URI, local: prefix ?? "xmlns", text: escapeAttribute(uri) });
  }
  const head = writeOpenTag({ name: g, group: true, attrs: canonicalOrder(attrs), children: [], text: null }, false);
  // Il gruppo prende per nome il titolo dell'SVG, o il nome del file: il
  // titolo della radice lo è già se entra fra i figli del gruppo.
  const titled = root.children.find((child) => {
    const element = doc.element(child);
    return element !== null && isSvg(element, "title");
  });
  const kept = inner.length === 0 && titled !== undefined && !source.dropped.has(titled);
  const name = kept ? null : (firstTitle(doc, root) ?? source.name);
  const title = name === null || name === "" ? null : `<${tag}>${escapeText(name)}</${tag}>`;
  const body = parts.map((part) => part.text).join("");
  let whole = `${head}${title === null ? "" : `\n  ${title}`}`;
  if (inner.length > 0) {
    let open = `<${g} id="${sheetScope!}"`;
    for (const index of inner) open += ` ${root.attrs[index]!.name}="${textOf(index)}"`;
    whole += `\n  ${open}>${body}</${g}>\n</${g}>`;
  } else {
    whole += `${body}</${g}>`;
  }
  const text = reindent(whole, scope, place, depth, "", indent, lift.written);
  const bytes = jsonBytes(text);
  if (bytes <= CHUNK_BYTES || inner.length > 0) {
    adds.push(target.to.parent, `\n${indent}`, text, bytes);
  } else {
    // Troppo grande per un'operazione sola: il gruppo vuoto, poi i suoi
    // figli a sequenze. Ciò che non è un elemento, fra loro, resta fuori.
    const empty = `${head.slice(0, -1)}/>`;
    adds.push(target.to.parent, `\n${indent}`, empty, jsonBytes(empty));
    const inside = scopeInside(scope, readOpen(empty, scope));
    const childIndent = `${indent}  `;
    if (title !== null) adds.push(group!, `\n${childIndent}`, title, jsonBytes(title));
    for (const part of parts) {
      if (part.id === null) continue;
      const from = doc.source.indent(doc.nodes[part.id]!.start);
      emit(rewriter, adds, part.id, group!, rewriter.idOf(part.id), from, childIndent, inside, "inside", depth + 1);
    }
  }
  adds.flush();
  return { ops, keys: [group!], bounds, symbols: lift.symbols };
}

/// Il contenuto del simbolo `child` dell'SVG nel simbolo `into` del disegno,
/// dopo il suo primo `title`: ogni figlio col suo testo riscritto, a pezzi
/// se è troppo grande; il `title` di `child` resta fuori, perché il nome
/// è quello del disegno.
export function refillWith(rewriter: Rewriter, adds: Adds, child: NodeId, into: ContainerNode, model: DocumentModel): void {
  const doc = rewriter.doc;
  const element = doc.element(child)!;
  const scope = scopeOf(into);
  const inner = elementChildren(into);
  const indent = inner.length > 0 ? indentOf(model, inner[0]!) : `${indentOf(model, into)}  `;
  const title = element.children.find((at) => {
    const node = doc.element(at);
    return node !== null && isSvg(node, "title");
  });
  for (const at of element.children) {
    const node = doc.element(at);
    if (node === null || at === title) continue;
    const from = doc.source.indent(node.start);
    rewriter.used.clear();
    rewriter.body(at, true);
    const declarations = needed(scopeOfChain(ancestors(doc, at)), scope, rewriter.used, node);
    rewriter.head(at, { set: new Map(), before: null, canonical: false, unlayer: false, declarations, id: null, child: null }, from);
    emit(rewriter, adds, at, into.facts.id!, rewriter.idOf(at), from, indent, scope, "inside", into.depth + 1);
  }
  adds.flush();
}

/// L'elemento del tag `open`, scritto da solo dove vale `scope`.
export function readOpen(open: string, scope: NamespaceScope): ElementNode {
  const fragment = parseFragment(open, scope)!;
  return fragment.doc.element(fragment.id)!;
}

/// Vero se un attributo della radice di un SVG incollato va sul gruppo che la
/// sostituisce: uno degli attributi ereditati, l'opacità o la visibilità,
/// con un valore che il formato ammette su un gruppo.
export function admitted(attr: Attr): boolean {
  if (!INHERITED.includes(attr.local) && attr.local !== "opacity" && attr.local !== "display") return false;
  return !/url\(/i.test(attr.value) && svgAttribute("g", attr.local, attr.value);
}

/// Gli indici degli attributi della radice di un SVG incollato che vanno sul
/// gruppo dentro: quelli senza namespace che il gruppo nuovo non ammette e
/// che non valgono solo sulla radice. Uno `style` che dice soltanto
/// `enable-background`, che nessun programma disegna più, resta fuori.
export function innerAttributes(root: ElementNode): number[] {
  const out: number[] = [];
  root.attrs.forEach((attr, index) => {
    if (attr.ns !== NS_NONE || attr.local === "id" || ROOT_ONLY.has(attr.local) || admitted(attr)) return;
    if (attr.local === "style" && attr.value.split(";").every((part) => part.trim() === "" || /^\s*enable-background\s*:/i.test(part))) return;
    out.push(index);
  });
  return out;
}

/// Il testo di `id`, con le modifiche, nel rientro `indent` di chi riceve: in
/// un `add`, o, se è un contenitore modificabile troppo grande, il suo tag
/// vuoto e poi i figli, ognuno allo stesso modo. `key` è il suo id dopo,
/// `from` il rientro della sua riga.
export function emit(
  rewriter: Rewriter,
  adds: Adds,
  id: NodeId,
  parent: string,
  key: string | null,
  from: string,
  indent: string,
  scope: NamespaceScope,
  place: Place,
  depth: number,
): void {
  const doc = rewriter.doc;
  const element = doc.element(id)!;
  const text = reindent(rewriter.slice(element.start, element.end), scope, place, depth, from, indent, rewriter.rules.written);
  const bytes = jsonBytes(text);
  const found = bytes > CHUNK_BYTES ? classifyChild(doc, id, place, depth, rewriter.rules.resolve) : null;
  if (key === null || found === null || !isContainer(found[1]) || element.closeStart === null) {
    adds.push(parent, `\n${indent}`, text, bytes);
    return;
  }
  // In un contenitore bloccato non si aggiunge: il blocco arriva dopo i
  // figli.
  const locked = valueOf(element, NS_FUB, "locked") === "true";
  let empty = `${rewriter.slice(element.start, element.openEnd).slice(0, -1)}/>`;
  if (locked) empty = unlocked(empty, scope);
  adds.push(parent, `\n${indent}`, empty, jsonBytes(empty));
  const inside = scopeInside(scope, readOpen(empty, scope));
  const childIndent = `${indent}  `;
  const added = rewriter.added.get(id);
  if (added !== undefined) adds.push(key, `\n${childIndent}`, added, jsonBytes(added));
  for (const child of element.children) {
    const node = doc.element(child);
    if (node === null) continue;
    emit(rewriter, adds, child, key, rewriter.idOf(child), doc.source.indent(node.start), childIndent, inside, "inside", depth + 1);
  }
  if (locked) adds.then({ op: "set", id: key, attrs: { "fub:locked": "true" } });
}

/// Il tag `open`, scritto dove vale `scope`, senza `fub:locked`.
export function unlocked(open: string, scope: NamespaceScope): string {
  const element = readOpen(open, scope);
  const attr = element.attrs.find((at) => at.ns === NS_FUB && at.local === "locked");
  if (attr === undefined) return open;
  const end = attr.raw[1] + 1 - element.start;
  const name = open.lastIndexOf(attr.name, attr.raw[0] - element.start);
  return open.slice(0, name).trimEnd() + open.slice(end);
}
