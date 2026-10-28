// Il navigatore (D7): una panoramica del disegno nell'angolo in basso a
// destra del foglio, col riquadro di ciò che si vede. Premere nella
// panoramica porta la vista lì, e trascinare la sposta; il disegno non
// cambia. Si accende da «Disegno › Vista». Chi usa la tastiera ha gli stessi
// spostamenti con i tasti della vista: la panoramica è un aiuto del puntatore,
// e i lettori di schermo non la vedono.

import type { Bounds } from "../../../scene/geometry";
import type { Point } from "../../../scene/matrix";
import { t } from "../../../strings";
import { placedAt, sceneCorners, type View } from "../../../view";
import type { EditorContext } from "../context";
import { union } from "../helpers";

const SVG_NS = "http://www.w3.org/2000/svg";

/// Quanto spazio resta attorno a ciò che la panoramica mostra, in parti della
/// sua misura più grande.
const NAVIGATOR_MARGIN = 0.06;

export interface NavigatorContext {
  /// La panoramica è accesa.
  navigator: boolean;
  setNavigator: (on: boolean) => void;
}

/// Ciò che la panoramica inquadra: il disegno e la parte che si vede, con un
/// margine.
export function navigatorBox(content: Bounds | null, seen: readonly Point[]): Bounds {
  let box = content;
  for (const at of seen) box = union(box, { min: at, max: at });
  if (box === null) return { min: [0, 0], max: [1, 1] };
  const pad = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], 1) * NAVIGATOR_MARGIN;
  return { min: [box.min[0] - pad, box.min[1] - pad], max: [box.max[0] + pad, box.max[1] + pad] };
}

export function installNavigator(ctx: EditorContext): void {
  ctx.navigator = false;
  const box = document.createElement("div");
  box.className = "draw-navigator";
  box.hidden = true;
  box.setAttribute("aria-hidden", "true");
  box.title = t("draw.navigator.hint");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "draw-navigator-map");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const sheets = document.createElementNS(SVG_NS, "g");
  sheets.setAttribute("class", "draw-navigator-sheets");
  const shapes = document.createElementNS(SVG_NS, "g");
  shapes.setAttribute("class", "draw-navigator-shapes");
  const seen = document.createElementNS(SVG_NS, "polygon");
  seen.setAttribute("class", "draw-navigator-view");
  svg.append(sheets, shapes, seen);
  box.append(svg);
  // Subito dopo il foglio: le barre che vengono dopo le stanno sopra.
  ctx.surface.after(box);

  /// Il disegno nella panoramica, rifatto soltanto quando cambia.
  let drawn: unknown = null;
  let content: Bounds | null = null;
  /// La vista e la misura dell'ultimo disegno della panoramica.
  let shownFor: { camera: View; w: number; h: number; index: unknown } | null = null;
  /// Ciò che la panoramica inquadra adesso.
  let frame: Bounds = { min: [0, 0], max: [1, 1] };

  const rect = (into: SVGGElement, [x, y, w, h]: readonly [number, number, number, number]): void => {
    const shape = document.createElementNS(SVG_NS, "rect");
    shape.setAttribute("x", String(x));
    shape.setAttribute("y", String(y));
    shape.setAttribute("width", String(Math.max(w, 0)));
    shape.setAttribute("height", String(Math.max(h, 0)));
    shape.setAttribute("vector-effect", "non-scaling-stroke");
    into.append(shape);
  };

  const drawContent = (): void => {
    const index = ctx.currentIndex();
    const page = ctx.currentPage();
    const boards = ctx.boardsNow();
    const key = [index, page, boards];
    if (Array.isArray(drawn) && drawn.every((one, at) => one === key[at])) return;
    drawn = key;
    sheets.replaceChildren();
    shapes.replaceChildren();
    content = null;
    if (boards.length > 0) {
      for (const board of boards) {
        rect(sheets, board.rect);
        content = union(content, board.box);
      }
    } else if (page !== null) {
      rect(sheets, [page.x, page.y, page.width, page.height]);
      content = union(content, { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] });
    }
    for (const unit of index.units) {
      if (unit.bounds === null) continue;
      const { min, max } = unit.bounds;
      rect(shapes, [min[0], min[1], max[0] - min[0], max[1] - min[1]]);
      content = union(content, unit.bounds);
    }
  };

  const show = (): void => {
    if (!ctx.navigator || ctx.disposed) return;
    drawContent();
    const area = ctx.viewArea();
    if (shownFor !== null && shownFor.camera === ctx.camera && shownFor.w === area.w && shownFor.h === area.h && shownFor.index === drawn) return;
    shownFor = { camera: ctx.camera, w: area.w, h: area.h, index: drawn };
    const corners = sceneCorners(ctx.camera, area);
    frame = navigatorBox(content, corners);
    svg.setAttribute("viewBox", `${frame.min[0]} ${frame.min[1]} ${frame.max[0] - frame.min[0]} ${frame.max[1] - frame.min[1]}`);
    seen.setAttribute("points", corners.map(([x, y]) => `${x},${y}`).join(" "));
    seen.setAttribute("vector-effect", "non-scaling-stroke");
  };
  ctx.life.add(ctx.status.subscribe(show));

  /// Il punto della scena sotto il puntatore, nella panoramica.
  const sceneOf = (event: PointerEvent): Point => {
    const box = svg.getBoundingClientRect();
    const w = frame.max[0] - frame.min[0];
    const h = frame.max[1] - frame.min[1];
    const k = Math.min(box.width / w, box.height / h) || 1;
    const left = box.left + (box.width - w * k) / 2;
    const top = box.top + (box.height - h * k) / 2;
    return [frame.min[0] + (event.clientX - left) / k, frame.min[1] + (event.clientY - top) / k];
  };

  /// Porta il punto `at` della scena in mezzo a ciò che si vede.
  const centerOn = (at: Point): void => {
    const area = ctx.viewArea();
    ctx.placed = true;
    ctx.setCamera(placedAt(ctx.camera, at, [area.x + area.w / 2, area.y + area.h / 2]));
  };

  /// Il trascinamento in corso: il puntatore, e quanto dista dal mezzo della
  /// vista nella scena, così la vista non salta sotto la mano.
  let drag: { readonly id: number; readonly offset: Point } | null = null;
  ctx.life.listen(box, "pointerdown", (event: PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    const at = sceneOf(event);
    const area = ctx.viewArea();
    const middle = sceneCorners(ctx.camera, area).reduce<Point>((sum, [x, y]) => [sum[0] + x / 4, sum[1] + y / 4], [0, 0]);
    const inside = seen.getAttribute("points") !== null && insideOf(sceneCorners(ctx.camera, area), at);
    const offset: Point = inside ? [middle[0] - at[0], middle[1] - at[1]] : [0, 0];
    if (!inside) centerOn(at);
    drag = { id: event.pointerId, offset };
    try {
      box.setPointerCapture(event.pointerId);
    } catch {
      // Non catturabile: il trascinamento prosegue finché il puntatore resta sopra.
    }
  });
  ctx.life.listen(box, "pointermove", (event: PointerEvent) => {
    if (drag === null || event.pointerId !== drag.id) return;
    const at = sceneOf(event);
    centerOn([at[0] + drag.offset[0], at[1] + drag.offset[1]]);
  });
  const end = (event: PointerEvent): void => {
    if (drag !== null && event.pointerId === drag.id) drag = null;
  };
  ctx.life.listen(box, "pointerup", end);
  ctx.life.listen(box, "pointercancel", end);

  ctx.setNavigator = (on) => {
    if (ctx.navigator === on || ctx.disposed) return;
    ctx.navigator = on;
    box.hidden = !on;
    drag = null;
    shownFor = null;
    show();
    ctx.announce(t(on ? "draw.navigator.on" : "draw.navigator.off"));
  };
}

/// Se `p` sta dentro il quadrilatero convesso `corners`.
function insideOf(corners: readonly Point[], p: Point): boolean {
  let sign = 0;
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k]!;
    const b = corners[(k + 1) % corners.length]!;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}
