// Gli aiuti dei test degli strumenti: un motore aperto su un documento di
// prova e l'indice dei suoi oggetti, come li vede l'editor.

import { PaintBuilder } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import type { Bounds } from "../scene/geometry";
import { compose } from "../scene/matrix";
import type { ContainerNode } from "../scene/model";
import { SourceText } from "../scene/text";
import { parseXml, SVG_NS } from "../scene/xml";
import { Cascade, renders, SILENT, type CascadeNode, type World } from "./cascade";
import { SceneIndexer, type ForeignBlock, type SceneIndex, type Unit } from "./hit";
import { readDeclarations, readSheets, type StyleAttr } from "./selectors";

export const LAYER = '<g id="l1" fub:layer="Livello 1">';

export interface Opened {
  readonly engine: SceneEngine;
  readonly index: SceneIndex;
  /// L'indice di adesso, dopo le operazioni applicate al motore; con
  /// `scope`, quello del gruppo isolato.
  reindex(scope?: ContainerNode | null): SceneIndex;
  /// Gli oggetti che si vedono adesso, coi figli dei contenitori `open`.
  seen(open?: ReadonlySet<ContainerNode>): Unit[];
  /// Vero se adesso dentro `container` si sceglie.
  opens(container: ContainerNode): boolean;
  /// Il riquadro di tutto il disegno di adesso.
  extent(): Bounds | null;
  /// Gli oggetti che una tavola porta con sé, adesso.
  movable(): Unit[];
  /// I collegamenti che si vedono adesso, a ogni profondità.
  links(): Unit[];
  /// Il riquadro della miniatura dell'elemento di id `id`, adesso.
  frame(id: string): Bounds | null;
  /// I blocchi estranei che si vedono fuori dagli oggetti, adesso.
  foreign(): ForeignBlock[];
}

export function open(source: string): Opened {
  const engine = SceneEngine.open(source);
  const builder = new PaintBuilder();
  const indexer = new SceneIndexer(builder, (id) => engine.holder(id));
  const reindex = (scope: ContainerNode | null = null): SceneIndex => {
    builder.build(engine);
    return indexer.index(engine.model!, scope);
  };
  const seen = (open?: ReadonlySet<ContainerNode>): Unit[] => {
    builder.build(engine);
    return indexer.seen(engine.model!, open);
  };
  const opens = (container: ContainerNode): boolean => {
    builder.build(engine);
    return indexer.opens(engine.model!, container);
  };
  const extent = (): Bounds | null => {
    builder.build(engine);
    return indexer.extent(engine.model!);
  };
  const links = (): Unit[] => {
    builder.build(engine);
    return indexer.links(engine.model!);
  };
  const movable = (): Unit[] => {
    builder.build(engine);
    return indexer.movable(engine.model!);
  };
  const frame = (id: string): Bounds | null => {
    builder.build(engine);
    const node = engine.holder(id);
    if (node === null) throw new Error(`nessun elemento ${id}`);
    return indexer.frameOf(engine.model!, node);
  };
  const foreign = (): ForeignBlock[] => {
    builder.build(engine);
    return indexer.foreignBlocks(engine.model!);
  };
  return { engine, index: reindex(), reindex, seen, opens, extent, links, movable, frame, foreign };
}

/// Le proprietà che [`appearance`] guarda, oltre a trasformazione e opacità.
export const LOOKED: readonly string[] = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "visibility", "display", "color", "filter", "clip-path", "mask",
];

/// I tag che si vedono da sé.
const DRAWN: ReadonlySet<string> = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "image", "use"]);

/// Ciò che si vede di ogni elemento disegnato di `text`, in ordine di
/// documento, come lo calcola la cascata: il tag con la classe, la
/// trasformazione e l'opacità accumulate dalla radice, e le proprietà di
/// [`LOOKED`] che vi si vedono. Due disegni con gli stessi elementi si vedono
/// uguali se le due liste sono uguali, nello stesso ordine o, dopo un comando
/// che li riordina, una volta ordinate.
export function appearance(text: string): string[] {
  const doc = parseXml(new SourceText(text), false);
  interface Built extends CascadeNode {
    readonly parent: Built | null;
    readonly children: Built[];
    readonly attrs: StyleAttr[];
    sheet: string | null;
  }
  const build = (id: number, parent: Built | null): Built => {
    const element = doc.element(id)!;
    const attrs = element.attrs.filter((attr) => attr.name !== "xmlns" && !attr.name.startsWith("xmlns:")).map((attr) => ({ uri: doc.namespaces[attr.ns]!, local: attr.local, value: attr.value }));
    let css = "";
    let hasText = false;
    for (const child of doc.children(id)) {
      const node = doc.nodes[child]!;
      if (node.kind === "text" || node.kind === "cdata") {
        hasText = true;
        css += node.value;
      }
    }
    const type = attrs.find((attr) => attr.local === "type")?.value.trim().toLowerCase() ?? "";
    const sheet = element.local === "style" && (type === "" || type === "text/css") ? css : null;
    const built: Built = { uri: doc.namespaces[element.ns]!, local: element.local, attrs, parent, children: [], text: hasText, sheet };
    for (const child of doc.children(id)) if (doc.element(child) !== null) built.children.push(build(child, built));
    return built;
  };
  const root = build(doc.root, null);
  const order: Built[] = [];
  const visit = (node: Built): void => {
    order.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  const sheets = order.filter((node) => node.sheet !== null).map((node, at) => ({ id: String(at), css: node.sheet! }));
  const inline = new Set<string>();
  for (const node of order) for (const attr of node.attrs) if (attr.local === "style") for (const declaration of readDeclarations(attr.value)) inline.add(declaration.property);
  const cascade = new Cascade(readSheets(sheets), root, (node) => (node as Built).attrs.find((attr) => attr.local === "id")?.value ?? "?", inline);
  const silent = (node: Built): boolean => {
    for (let at: Built | null = node; at !== null; at = at.parent) if (SILENT.has(at.local)) return true;
    return false;
  };
  const round = (v: number): string => (Math.abs(v) < 5e-4 ? "0" : v.toFixed(3));
  const attr = (node: Built, local: string): string | null => node.attrs.find((each) => each.local === local)?.value ?? null;
  const byId = new Map(order.map((node) => [attr(node, "id"), node]));
  // Una copia collegata si vede dove la porta il `use`, con la
  // trasformazione dell'elemento che mostra.
  const placed = (node: Built): World => {
    const world = cascade.world(node);
    if (node.local !== "use") return world;
    const shown = byId.get((attr(node, "href") ?? attr(node, "xlink:href") ?? "").slice(1));
    const own = shown === undefined ? null : cascade.own(shown).m;
    if (own === null) return world;
    return { m: compose(world.m, compose([1, 0, 0, 1, Number(attr(node, "x") ?? 0), Number(attr(node, "y") ?? 0)], own)), sym: world.sym };
  };
  return order
    .filter((node) => node.uri === SVG_NS && DRAWN.has(node.local) && !silent(node))
    .map((node) => {
      const world = placed(node);
      const alpha = cascade.alpha(node);
      const values = LOOKED.filter((p) => renders(node, p)).map((p) => `${p}=${cascade.value(node, p).key}`);
      const name = attr(node, "class");
      const who = `${node.local}${name === null ? "" : `.${name}`}`;
      return `${who} [${world.m.map(round).join(" ")}]${world.sym} a=${round(alpha.a)}${alpha.sym} ${values.join(" ")}`;
    });
}
