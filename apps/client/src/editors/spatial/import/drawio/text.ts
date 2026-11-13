// Il testo delle celle di draw.io: l'HTML, gli spazi ai capi e il testo
// messo in un punto.

import type { Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import type { Content, TextNode } from "../diagram";
import { num } from "./file";
import type { Style } from "./style";

/// Quanto un testo può stare fuori dal mezzo della sua forma e restarne
/// l'etichetta, che FubDraw mette nel mezzo.
const OFF_CENTRE = 4;

/// `box` stretto di `before` e `after` lungo l'asse `axis`, fino al suo
/// mezzo.
export function shrunk(box: Bounds, axis: 0 | 1, before: number, after: number): Bounds {
  const min: [number, number] = [box.min[0], box.min[1]];
  const max: [number, number] = [box.max[0], box.max[1]];
  min[axis] += before;
  max[axis] -= after;
  if (max[axis] < min[axis]) min[axis] = max[axis] = (min[axis] + max[axis]) / 2;
  return { min, max };
}

/// L'HTML di un'etichetta di draw.io: come lì, gli a capo in fondo sono
/// righe vuote, gli altri `br`.
export function htmlText(raw: string): string {
  const tail = /(?:\r?\n)*$/.exec(raw)![0];
  return raw.slice(0, raw.length - tail.length).replace(/\r?\n/g, "<br>") + "<div><br></div>".repeat(tail.split("\n").length - 1);
}

/// Quante righe vuote ha `content` in cima e in fondo.
export function blankEnds(content: Content): readonly [number, number] {
  const blank = content.paragraphs.map((runs) => runs.every((run) => run.text.trim() === ""));
  const lead = blank.indexOf(false);
  if (lead < 0) return [0, 0];
  return [lead, blank.length - 1 - blank.lastIndexOf(false)];
}

/// Vero se il testo `content`, nel mezzo della sua forma di stile `style`
/// per draw.io, ci sta anche per FubDraw: gli spazi attorno quasi pari, e
/// non più righe vuote in cima che in fondo, che FubDraw non tiene.
export function balanced(style: Style, content: Content): boolean {
  const [lead, trail] = blankEnds(content);
  const dx = (num(style.get("spacingLeft"), 0) - num(style.get("spacingRight"), 0)) / 2;
  const dy = (num(style.get("spacingTop"), 0) - num(style.get("spacingBottom"), 0) + (lead - trail) * content.leading * content.type.size) / 2;
  return Math.abs(dx) <= OFF_CENTRE && Math.abs(dy) <= OFF_CENTRE;
}

/// Un testo di `content` col centro in `at`, senza riquadro.
export function pointText(content: Content, at: Point, opacity: number): TextNode {
  const height = content.paragraphs.length * content.leading * content.type.size;
  const top = at[1] - height / 2;
  return {
    type: "text",
    key: "",
    locked: false,
    spin: null,
    at: [at[0], top + content.type.size],
    width: null,
    frame: { top, bottom: top + height, align: "middle" },
    content: { ...content, align: "middle" },
    opacity,
  };
}
