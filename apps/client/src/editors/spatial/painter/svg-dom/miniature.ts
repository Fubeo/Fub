// Il painter SVG DOM, le miniature: alcuni nodi della scena in un `svg` a sé,
// con le risorse e i simboli che usano, e la miniatura come immagine ferma
// (`../svg-dom.ts`).

import type { Lifetime } from "../../../../ui/lifetime";
import { fubLiveFamily } from "../../fonts/faces";
import type { PaintAttr, PaintGroup, PaintNode, PaintResource } from "../paint";
import { type LiveDom, liveId, type PainterOptions, setFamily, SVG } from "./base";
import { resourceElement, setCommon, setPainted, setSymbol, shapeElement } from "./elements";

/// Quante miniature si sono disegnate: ognuna ha il suo prefisso per gli id
/// delle risorse.
let miniatures = 0;

/// Gli attributi che nascondono: una miniatura mostra anche ciò che il
/// disegno nasconde.
export const HIDING: ReadonlySet<string> = new Set(["display", "visibility"]);

/// Il riquadro che una miniatura inquadra, in unità della scena.
export interface MiniatureBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Il margine di una miniatura attorno al suo riquadro, in frazioni del lato
/// più lungo.
export const MINIATURE_MARGIN = 0.06;

/// Una miniatura dei nodi `nodes`: un `svg` che inquadra `box`, con dentro un
/// `g` per ogni contenitore di `chain`, dal più esterno, che porta i suoi
/// attributi dipinti. Né i nodi né chi li contiene sono nascosti; ciò che è
/// nascosto dentro di loro sì. Nessun `data-scene-id`: la miniatura non è
/// la scena. Le immagini del vault le chiede a `resolve` nella vita `life`.
/// Le risorse `resources`, quelle che i nodi usano ([`resourcesFor`]),
/// stanno in una `defs` dentro il primo `g`, che porta gli attributi della
/// radice, con un prefisso della miniatura; con loro i simboli `symbols`,
/// quelli delle istanze ([`symbolsFor`]). Le famiglie vive sono quelle di
/// `family`: di partenza, le sole famiglie di Fub.
export function paintMiniature(
  nodes: readonly PaintNode[],
  chain: readonly (readonly PaintAttr[])[],
  box: MiniatureBox,
  life: Lifetime,
  resolve?: PainterOptions["images"],
  resources: readonly PaintResource[] = [],
  family: (value: string) => string = fubLiveFamily,
  symbols: readonly PaintGroup[] = [],
): SVGSVGElement {
  const visible = (attrs: readonly PaintAttr[]): readonly PaintAttr[] => attrs.filter(([name]) => !HIDING.has(name));
  const dom: LiveDom = { prefix: `fubthumb${++miniatures}-`, family };
  const svg = document.createElementNS(SVG, "svg");
  const pad = Math.max(box.width, box.height) * MINIATURE_MARGIN || 1;
  svg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("focusable", "false");
  setFamily(svg, "", dom);
  let parent: SVGElement = svg;
  const defs = resources.length === 0 && symbols.length === 0 ? null : document.createElementNS(SVG, "defs");
  for (const resource of resources) {
    const el = resourceElement(resource, dom);
    if (el !== null) defs!.append(el);
  }
  for (const attrs of chain) {
    const g = document.createElementNS(SVG, "g");
    setPainted(g, visible(attrs), [], dom);
    parent.append(g);
    // Il contenuto delle risorse eredita dalla radice, non da chi le usa.
    if (parent === svg && defs !== null) g.append(defs);
    parent = g;
  }
  if (parent === svg && defs !== null) svg.append(defs);
  // Gli originali delle copie hanno l'id vivo della miniatura.
  const originals = new Set<string>();
  const scan = (node: PaintNode): void => {
    if (node.kind === "group") node.children.forEach(scan);
    else if (node.original !== undefined) originals.add(node.original);
  };
  nodes.forEach(scan);
  symbols.forEach(scan);
  const anchor = (el: SVGElement, id: string | null): void => {
    if (id !== null && originals.has(id)) el.setAttribute("id", liveId(dom.prefix, id));
  };
  const copy = (node: PaintNode, top: boolean): SVGElement => {
    if (node.kind === "shape") {
      const { el } = shapeElement(node, null, dom, resolve, life);
      if (top) for (const name of HIDING) el.removeAttribute(name);
      anchor(el, node.id);
      return el;
    }
    const el = document.createElementNS(SVG, node.role === "symbol" ? "symbol" : "g");
    setPainted(el, top ? visible(node.attrs) : node.attrs, [], dom);
    setCommon(el, null, node.space);
    if (node.role === "symbol") setSymbol(el, node.id!, dom);
    else anchor(el, node.id);
    for (const child of node.children) el.append(copy(child, false));
    return el;
  };
  for (const symbol of symbols) defs!.append(copy(symbol, false));
  for (const node of nodes) parent.append(copy(node, true));
  return svg;
}

/// La miniatura `svg` come immagine ferma: un `img` solo al posto di tante
/// forme vive. Le immagini del vault non ci sono, perché un'immagine non ne
/// carica altre. L'URL si revoca quando si chiude `life`.
export function miniaturePicture(svg: SVGSVGElement, life: Lifetime): HTMLImageElement {
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  life.add(() => URL.revokeObjectURL(url));
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.src = url;
  return img;
}
