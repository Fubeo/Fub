// Gli aiuti sui nodi del diagramma importato: l'ingombro, i nomi, lo
// spostamento, e ciò che una cella eredita dalla sua corsia.

import { BoundsBuilder, type Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import type { Content, Hook, Node, Spin } from "../diagram";

/// Il riquadro, a stima, di `nodes`.
export function extentOf(nodes: readonly Node[]): Bounds | null {
  const out = new BoundsBuilder();
  const box = (bounds: Bounds): void => {
    out.include(bounds.min);
    out.include(bounds.max);
  };
  const visit = (node: Node): void => {
    switch (node.type) {
      case "shape":
      case "image":
        box(node.box);
        return;
      case "text": {
        const width = node.width ?? 0;
        const left = node.content.align === "start" ? node.at[0] : node.content.align === "end" ? node.at[0] - width : node.at[0] - width / 2;
        box({ min: [left, node.frame?.top ?? node.at[1]], max: [left + width, node.frame?.bottom ?? node.at[1]] });
        return;
      }
      case "path":
        node.points.forEach((p) => out.include(p));
        return;
      case "line":
        out.include(node.from.at);
        out.include(node.to.at);
        node.route?.forEach((p) => out.include(p));
        return;
      case "ink":
        node.samples.forEach((s) => out.include([s.x, s.y]));
        return;
      case "group":
        node.children.forEach(visit);
        return;
    }
  };
  nodes.forEach(visit);
  return out.finish();
}

/// Un rettangolo che non si vede sul riquadro `box`: il contorno a cui si
/// agganciano gli archi di una cella che non ne ha uno, o lo ha a pezzi.
/// Porta il nome della cella, `name`, perché un connettore dica a che cosa
/// è agganciato.
export function hookBox(box: Bounds, name: string): Node {
  return { type: "shape", key: "", locked: false, spin: null, box, form: { kind: "rect", corner: 0 }, look: { stroke: null, fill: null, opacity: 1 }, label: null, name };
}

/// Le parole di `content` su una riga.
const wordsOf = (content: Content): string =>
  content.paragraphs
    .map((runs) => runs.map((run) => run.text).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/// Le parole del primo testo di `nodes`, o della prima etichetta; vuoto se
/// non ne hanno.
export function nameIn(nodes: readonly Node[]): string {
  for (const node of nodes) {
    const content = node.type === "text" ? node.content : node.type === "shape" ? node.label : null;
    const words = content === null ? "" : wordsOf(content);
    if (words !== "") return words;
    if (node.type === "group") {
      const inner = nameIn(node.children);
      if (inner !== "") return inner;
    }
  }
  return "";
}

/// Le parole di tutti i testi di `nodes`, come quelle di una riga di una
/// tabella fatta di celle; vuoto se fra loro c'è altro che testi e righe.
export function rowName(nodes: readonly Node[]): string {
  const words: string[] = [];
  const walk = (each: readonly Node[]): boolean =>
    each.every((node) => {
      if (node.type === "group") return walk(node.children);
      if (node.type === "text") words.push(wordsOf(node.content));
      return node.type === "text" || node.type === "path" || node.type === "line";
    });
  return walk(nodes) ? words.filter((word) => word !== "").join(" ") : "";
}

/// `node` spostato di (`dx`, `dy`).
export function shifted(node: Node, dx: number, dy: number): Node {
  if (dx === 0 && dy === 0) return node;
  const p = (q: Point): Point => [q[0] + dx, q[1] + dy];
  const b = (box: Bounds): Bounds => ({ min: p(box.min), max: p(box.max) });
  const spin = node.spin === null ? null : { ...node.spin, centre: p(node.spin.centre) };
  switch (node.type) {
    case "shape":
      return { ...node, spin, box: b(node.box) };
    case "image":
      return { ...node, spin, box: b(node.box), flip: node.flip === null ? null : { ...node.flip, centre: p(node.flip.centre) } };
    case "text":
      return { ...node, spin, at: p(node.at), frame: node.frame === null ? null : { ...node.frame, top: node.frame.top + dy, bottom: node.frame.bottom + dy } };
    case "path":
      return { ...node, spin, points: node.points.map(p) };
    case "line": {
      const hook = (h: Hook): Hook => ({ ...h, at: p(h.at) });
      return { ...node, spin, from: hook(node.from), to: hook(node.to), route: node.route === null ? null : node.route.map(p) };
    }
    case "ink":
      return { ...node, spin, samples: node.samples.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) };
    case "group":
      return { ...node, spin, children: node.children.map((child) => shifted(child, dx, dy)) };
  }
}

/// I campi comuni a ogni nodo.
export type BaseOf = { readonly key: string; readonly locked: boolean; readonly spin: Spin | null };

/// Dove sta il testo di una cella, nella tela.
export interface Placed {
  /// Il riquadro in cui il testo si allinea.
  readonly box: Bounds;
  /// La rotazione del testo, oltre a quella della cella.
  readonly vertical: boolean;
}

/// Le chiavi dello stile che possono valere «inherit», il valore del
/// genitore, e quelle che possono valere «swimlane», il riempimento della
/// corsia attorno.
export const INHERITED = ["strokeColor", "fillColor", "fontColor", "strokeWidth", "gradientColor", "labelBackgroundColor", "labelBorderColor"];
export const FROM_LANE = ["strokeColor", "fillColor", "fontColor", "gradientColor", "labelBackgroundColor", "labelBorderColor"];
