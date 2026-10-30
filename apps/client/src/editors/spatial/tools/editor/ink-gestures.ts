// L'editor del disegno: i gesti della penna e della gomma. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { straight, STRAIGHT_SNAP, toLocal } from "../../../../ink/geometry";
import type { InkSample } from "../../../../ink/sample";
import { closedAtLimit } from "../../../../ink/tools/tool";
import { buildStroke } from "../../../../ink/tools/stroke";
import type { FinishedStroke } from "../../../../ink/input/session";
import { BoundsBuilder } from "../../scene/geometry";
import { apply, compose, type Matrix, type Point } from "../../scene/matrix";
import type { Op } from "../../scene/ops";
import { plural, t } from "../../strings";
import type { PaintNode } from "../../painter/paint";
import { cutPath, cutStroke } from "../erase-precise";
import { addOp, gesture as asGesture, strokeElem, type Destination } from "../edit";
import { inkAsPath } from "../ink-path";
import type { Elem } from "../../scene/serialize";
import { DRAG_PX } from "./constants";
import type { EditorContext } from "./context";
import { sameDestination } from "./helpers";
import type { EraseGesture, InkGesture } from "./types";

/// Un tratto entrato nel disegno: il suo id, il livello che l'ha ricevuto
/// e le sue copie in simmetria, ognuna con la trasformazione che porta il
/// tratto su di lei nelle coordinate del livello.
interface WrittenInk {
  readonly id: string;
  readonly to: Destination;
  readonly copies: readonly { readonly id: string; readonly matrix: Matrix }[];
}

/// I nodi di `keys` che `subs` ha.

/// Ciò che i gesti dell'inchiostro e della gomma danno agli altri pezzi
/// dell'editor.
export interface InkGesturesContext {
  eraseAlong: (g: EraseGesture, p: Point) => void;
  showErased: (g: EraseGesture) => void;
  writeInk: (g: InkGesture, split: boolean) => WrittenInk | null;
  copiesText: (copies: number) => string;
  finishInk: (g: InkGesture, stroke: FinishedStroke) => void;
}

/// Monta i gesti della penna e della gomma.
export function installInkGestures(ctx: EditorContext): void {
  const {
    suggestions, painter, currentIndex, grownPage, announce, objects, drawnPaint, commit, target, straightened
  } = ctx;
  const eraseAlong = (g: EraseGesture, p: Point): void => {
    const before = g.path[g.path.length - 1] ?? p;
    const marked = g.sweep.size;
    g.sweep.along(currentIndex(), p, ctx.camera.scale);
    g.path.push(p);
    g.radius ??= g.sweep.radius / ctx.camera.scale;
    if (ctx.grid.eraser !== "precise") return;
    // La gomma precisa ritaglia i tratti che il cammino tocca adesso: quelli
    // appena segnati, e quelli già tagliati che il nuovo pezzo di cammino
    // raggiunge ancora.
    const units = g.sweep.marked();
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      const known = g.cuts.get(unit.key);
      if (known === "whole") continue;
      if (i < marked && !unit.touches(before, p, g.radius)) continue;
      const cut = cutStroke(unit, g.path, g.radius);
      if (cut !== null) g.cuts.set(unit.key, cut);
    }
  };
  ctx.eraseAlong = eraseAlong;

  const showErased = (g: EraseGesture): void => {
    const faded = new Set<PaintNode>();
    const fadedContainers = new Set<object>();
    const paths = new Map<PaintNode, string>();
    const precise = ctx.grid.eraser === "precise";
    for (const unit of g.sweep.marked()) {
      const cut = precise ? g.cuts.get(unit.key) : "whole";
      // Un tratto che il cerchio sfiora senza tagliarlo resta com'è.
      if (cut === undefined) continue;
      if (cut !== "whole" && cut.pieces.length > 0) {
        paths.set(unit.paints[0]!, cutPath(cut));
        continue;
      }
      for (const paint of unit.paints) faded.add(paint);
      if (unit.node.kind === "container") fadedContainers.add(unit.node);
    }
    painter.setDraft(faded.size === 0 && fadedContainers.size === 0 && paths.size === 0 ? null : { faded, fadedContainers, paths });
  };
  ctx.showErased = showErased;

  /// Il tratto del gesto `g` entra nel disegno, sottile alla fine se non
  /// continua in un altro, con le sue copie in simmetria, in un passo solo.
  /// Torna il suo id, il livello che l'ha ricevuto e le copie, con la
  /// trasformazione che le porta nelle coordinate del livello; `null` se non
  /// è entrato.
  const writeInk = (g: InkGesture, split: boolean): WrittenInk | null => {
    // Il livello di adesso: mentre il gesto durava, il disegno può essere
    // cambiato.
    const to = target(g.ids);
    if (to === null) return null;
    const local = sameDestination(to, g.to) ? g.local : g.scene.map((sample) => toLocal(sample, to.inverse));
    const brush = closedAtLimit(g.brush, split);
    const samples = lineFromLast(g, local, to) ?? (straightened(g) ? straight(local, STRAIGHT_SNAP) : local);
    // Ogni copia è il tratto portato dalla sua trasformazione, nelle
    // coordinate del livello: un tratto vero, col suo inchiostro. Una che
    // uscirebbe dai numeri dell'inchiostro non si scrive.
    const built = buildStroke(samples, brush, g.copies.map((m) => compose(to.inverse, compose(m, to.matrix))));
    if (!built.ok) {
      if (built.reason === "failed") announce(t("draw.ink_failed"));
      return null;
    }
    const bounds = new BoundsBuilder();
    for (const point of built.outline) bounds.include(apply(to.matrix, point));
    const id = g.ids.next("object");
    const at = new Date(performance.timeOrigin + g.began).toISOString();
    const paint = drawnPaint(g.color);
    // Con l'uscita «Tracciato» la Penna lascia un tracciato al posto
    // dell'inchiostro (P11); uno che non si scrive resta inchiostro.
    const output = (elem: Elem): Elem => {
      if (g.tool !== "pen" || ctx.grid.output !== "path") return elem;
      const path = inkAsPath(elem, ctx.grid.fidelity ?? "medium");
      return path === null ? elem : { ...path, attrs: { id: elem.attrs.id!, ...path.attrs } };
    };
    const ops: Op[] = [...to.prelude, addOp(to, output(strokeElem(id, paint, brush, built.ink, at, g.tool, g.opacity)))];
    const copies: WrittenInk["copies"][number][] = [];
    for (const copy of built.copies) {
      for (const point of copy.outline) bounds.include(apply(to.matrix, point));
      const copyId = g.ids.next("object");
      ops.push(addOp(to, output(strokeElem(copyId, paint, brush, copy.ink, at, g.tool, g.opacity))));
      copies.push({ id: copyId, matrix: copy.matrix });
    }
    const page = grownPage(bounds.finish());
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit(g.tool === "highlighter" ? "draw.action.highlight" : "draw.action.stroke", asGesture(ops)) === null) return null;
    const end = samples[samples.length - 1]!;
    ctx.lastInk = { end: apply(to.matrix, [end.x, end.y]), tool: g.tool };
    return { id, to, copies };
  };

  /// Maiusc+clic: il tocco che non si è mosso diventa una linea dritta dalla
  /// fine dell'ultimo tratto dello stesso strumento. `null` se non è quel
  /// gesto.
  const lineFromLast = (g: InkGesture, local: readonly InkSample[], to: Destination): InkSample[] | null => {
    const last = ctx.lastInk;
    const first = local[0];
    if (!ctx.shift || last === null || last.tool !== g.tool || first === undefined) return null;
    const reach = DRAG_PX[g.pointer] / ctx.camera.scale;
    if (local.some((sample) => Math.hypot(sample.x - first.x, sample.y - first.y) > reach)) return null;
    const [x, y] = apply(to.inverse, last.end);
    const tip = local[local.length - 1]!;
    return straight([{ ...first, x, y, t: 0 }, { ...tip, t: Math.max(tip.t, 1) }]);
  };
  ctx.writeInk = writeInk;

  /// Ciò che si dice di un tratto appena scritto con `copies` copie in
  /// simmetria: nulla senza copie.
  const copiesText = (copies: number): string => (copies === 0 ? "" : ` ${plural(copies, "draw.symmetry.copies.one", "draw.symmetry.copies.other")}`);
  ctx.copiesText = copiesText;

  const finishInk = (g: InkGesture, stroke: FinishedStroke): void => {
    const written = writeInk(g, stroke.split);
    if (written === null) return;
    announce(`${t(g.tool === "highlighter" ? "draw.added.highlight" : "draw.added.stroke")}${copiesText(written.copies.length)} ${objects()}`);
    if (!stroke.split) offerAfterInk(g);
  };
  ctx.finishInk = finishInk;

  /// Dopo un tratto: col dito, le due dita che muovono il foglio; dopo uno
  /// che somiglia a una forma, il tratto tenuto fermo che lo diventa.
  const offerAfterInk = (g: InkGesture): void => {
    if (g.pointer === "touch" && suggestions.offer("two-fingers")) return;
    if (g.holds && ctx.shapesOn() && suggestions.wants("hold-shape") && ctx.strokeShapeOf(g) !== null) suggestions.offer("hold-shape");
  };
}
