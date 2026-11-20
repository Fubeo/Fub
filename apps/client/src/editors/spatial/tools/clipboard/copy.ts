// Gli appunti dei disegni, copiare: la selezione come documento SVG completo,
// che si apre anche da solo (`../clipboard.ts`).

import { formatNumber } from "../../number";
import { classifyChild, resourceIndex, type Resolve } from "../../scene/classify";
import { reindent } from "../../scene/engine";
import type { Bounds } from "../../scene/geometry";
import { compose, IDENTITY } from "../../scene/matrix";
import { escapeAttribute, formatTransform, NamespaceScope, scopeInside } from "../../scene/serialize";
import { SourceText } from "../../scene/text";
import { transform as parseTransform, urlIds } from "../../scene/values";
import { FUB_NS, isSvg, NS_FUB, NS_NONE, parseXml, valueOf, XmlError, type NodeId, type XmlDocument } from "../../scene/xml";
import { transformValue } from "../edit";
import {
  ancestors,
  copiedBox,
  copiedSize,
  elementAt,
  holdersById,
  holdsForeign,
  inheritedOf,
  isIdentity,
  needed,
  referencesOf,
  renders,
  scopeOfChain,
  subtree,
  Unresolved,
  viewBoxOf,
  within,
} from "./base";
import { Rewriter } from "./rewriter";

// ---------------------------------------------------------------------------
// Copiare.
// ---------------------------------------------------------------------------

/// Ciò che si copia.
export interface CopyInput {
  /// Il testo del disegno.
  readonly text: string;
  /// I percorsi degli elementi scelti: gli indici dei figli elemento dalla
  /// radice.
  readonly paths: ReadonlyArray<readonly number[]>;
  /// Il riquadro di ciò che si vede della selezione, nella scena.
  readonly bounds: Bounds;
}

/// Un prefisso libero in `scope`: `base`, o `base` con un numero.
export function freePrefix(scope: NamespaceScope, base: string): string {
  if (scope.uri(base) === null) return base;
  for (let n = 1; ; n++) if (scope.uri(`${base}${n}`) === null) return `${base}${n}`;
}

/// La selezione come documento SVG; `null` se non c'è niente da copiare, o
/// se un'entità del disegno non si sostituisce col suo testo.
export function copySvg(input: CopyInput): string | null {
  let doc: XmlDocument;
  try {
    doc = parseXml(new SourceText(input.text), false);
  } catch (error) {
    if (error instanceof XmlError) return null;
    throw error;
  }
  const root = doc.element(doc.root)!;
  const chosen = new Set<NodeId>();
  for (const path of input.paths) {
    const at = elementAt(doc, path);
    if (at !== null) chosen.add(at);
  }
  const tops = [...chosen].filter((id) => !within(doc, id, chosen)).sort((a, b) => doc.nodes[a]!.start - doc.nodes[b]!.start);
  if (tops.length === 0) return null;

  const rootScope = scopeInside(NamespaceScope.EMPTY, root);
  const known = rootScope.attributePrefix(FUB_NS);
  const fub = known ?? freePrefix(rootScope, "fub");
  const scope = known === null ? rootScope.declare([[fub, FUB_NS]]) : rootScope;
  const index = resourceIndex(doc);
  const resolve: Resolve = (id) => index.get(id) ?? null;
  const rewriter = new Rewriter(doc, { rename: () => null, relink: false, ids: new Map(), named: new Map(), colors: new Map(), styled: () => true, sheets: undefined, href: () => null, resolve, written: resolve });

  try {
    const pieces: string[] = [];
    // Le risorse a cui rimanda ciò che un elemento eredita e prende su di sé.
    const inherited: string[] = [];
    let foreign = false;
    for (const id of tops) {
      const element = doc.element(id)!;
      const chain = ancestors(doc, id);
      let matrix = IDENTITY;
      for (let i = chain.length - 2; i >= 0; i--) matrix = compose(matrix, parseTransform(valueOf(chain[i]!, NS_NONE, "transform") ?? "") ?? IDENTITY);
      const place = element.parent === doc.root ? "root" : "inside";
      const found = classifyChild(doc, id, place, chain.length, resolve);
      foreign ||= holdsForeign(doc, id, place, chain.length, resolve);
      const set = new Map<string, string | null>();
      let before: string | null = null;
      if (!isIdentity(matrix)) {
        const own = parseTransform(valueOf(element, NS_NONE, "transform") ?? "") ?? IDENTITY;
        if (found !== null) set.set("transform", transformValue(compose(matrix, own)));
        else if (renders(element)) before = formatTransform(matrix);
      }
      for (const name of inheritedOf(element, found)) {
        if (valueOf(element, NS_NONE, name) !== undefined) continue;
        const value = chain.map((at) => valueOf(at, NS_NONE, name)).find((v) => v !== undefined);
        if (value === undefined) continue;
        set.set(name, value);
        inherited.push(...urlIds(value));
      }
      rewriter.used.clear();
      rewriter.body(id, true);
      const declarations = needed(scopeOfChain(chain), scope, rewriter.used, element);
      const indent = doc.source.indent(element.start);
      rewriter.head(id, { set, before, canonical: found !== null && set.size > 0, unlayer: false, declarations, id: null, child: null }, indent);
      pieces.push(reindent(rewriter.slice(element.start, element.end), scope, "root", 1, indent, "  ", resolve));
    }

    const holders = holdersOf(doc, tops, foreign, inherited);
    const prefix = root.name.includes(":") ? root.name.slice(0, root.name.indexOf(":") + 1) : "";
    if (holders.length > 0) {
      let defs = `<${prefix}defs>`;
      for (const id of holders) {
        const element = doc.element(id)!;
        rewriter.used.clear();
        rewriter.body(id, true);
        const declarations = needed(scopeOfChain(ancestors(doc, id)), scope, rewriter.used, element);
        const indent = doc.source.indent(element.start);
        rewriter.head(id, { set: new Map(), before: null, canonical: false, unlayer: false, declarations, id: null, child: null }, indent);
        defs += `\n    ${reindent(rewriter.slice(element.start, element.end), scope, "defs", 2, indent, "    ", resolve)}`;
      }
      pieces.unshift(`${defs}\n  </${prefix}defs>`);
    }

    let head = `<${root.name}`;
    for (const attr of root.attrs) if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) head += ` ${attr.name}="${escapeAttribute(attr.value)}"`;
    if (known === null) head += ` xmlns:${fub}="${FUB_NS}"`;
    const box = copiedBox(input.bounds);
    const rootBox = viewBoxOf(valueOf(root, NS_NONE, "viewBox"));
    head += ` ${fub}:version="${escapeAttribute(valueOf(root, NS_FUB, "version") ?? "1")}"`;
    head += ` viewBox="${box.map((v) => formatNumber(v, 2)).join(" ")}"`;
    head += ` width="${escapeAttribute(copiedSize(valueOf(root, NS_NONE, "width"), rootBox?.[2], box[2]))}"`;
    head += ` height="${escapeAttribute(copiedSize(valueOf(root, NS_NONE, "height"), rootBox?.[3], box[3]))}"`;
    return `${head}>${pieces.map((piece) => `\n  ${piece}`).join("")}\n</${root.name}>\n`;
  } catch (error) {
    if (error instanceof Unresolved) return null;
    throw error;
  }
}

/// Ciò a cui rimandano gli elementi copiati, o gli id `extra`, e che resta
/// fuori, a cascata, e con `styles` i fogli di stile del documento:
/// nell'ordine del documento, senza chi sta dentro un altro di loro. Non la
/// radice né un antenato di ciò che si copia, che lo ripeterebbero.
export function holdersOf(doc: XmlDocument, tops: readonly NodeId[], styles: boolean, extra: readonly string[]): NodeId[] {
  const copied = new Set(tops);
  const around = new Set<NodeId>();
  for (const top of tops) for (let at = doc.nodes[top]!.parent; at !== null; at = doc.nodes[at]!.parent) around.add(at);
  const taken = new Set<NodeId>();
  const pending: string[] = [...extra];
  const scan = (id: NodeId): void => {
    for (const at of subtree(doc, id)) pending.push(...referencesOf(doc, doc.element(at)!));
  };
  const take = (id: NodeId): void => {
    if (taken.has(id) || copied.has(id) || around.has(id) || within(doc, id, copied)) return;
    taken.add(id);
    scan(id);
  };
  for (const top of tops) scan(top);
  if (styles) doc.nodes.forEach((node, id) => {
    if (node.kind === "element" && isSvg(node, "style")) take(id);
  });
  let byId: Map<string, NodeId> | null = null;
  while (pending.length > 0) {
    byId ??= holdersById(doc);
    const holder = byId.get(pending.pop()!);
    if (holder !== undefined) take(holder);
  }
  return [...taken].filter((id) => !within(doc, id, taken)).sort((a, b) => doc.nodes[a]!.start - doc.nodes[b]!.start);
}
