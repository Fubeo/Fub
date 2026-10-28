// L'editor del disegno: il righello (P13). Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.
//
// Il righello sta sopra il foglio finché non lo si toglie, dal menu Vista o
// dalla palette; non entra nel file. Il puntatore lo prende in mezzo e lo
// sposta; la rotella sopra lo gira a gradi, con Maiusc a passi di 15°; due
// dita appoggiate sopra lo spostano e lo girano. Un tratto della Penna o
// dell'Evidenziatore che comincia vicino a un bordo lo segue (`../ruler.ts`).

import type { InkBrush } from "../../../../ink/brush";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { InkSample } from "../../../../ink/sample";
import type { Point } from "../../scene/matrix";
import type { OverlayHandle } from "../../painter/overlay";
import { t } from "../../strings";
import { normalTurn, toScene, toScreen } from "../../view";
import type { Destination } from "../edit";
import { alongEdge, onRuler, onRulerBody, rulerDegrees, rulerEdge, RULER_WIDTH_PX, steppedRuler, turnedRuler, type Ruler, type RulerEdge } from "../ruler";
import { DRAG_PX } from "./constants";
import type { EditorContext } from "./context";
import { scaleOf } from "./helpers";
import type { GestureBase, RulerGesture } from "./types";

/// Quanto vicino a un bordo, in pixel dello schermo, un tratto lo segue.
const RULER_REACH_PX: Readonly<Record<InkPointerType, number>> = { pen: 16, mouse: 12, touch: 24 };
/// Quanta rotella fa un grado, e quanta un passo con Maiusc.
const WHEEL_PER_DEGREE = 20;
const WHEEL_PER_STEP = 60;

/// Due dita sul foglio, in pixel del foglio: il punto di mezzo e l'angolo
/// della retta che le unisce, `null` con un dito solo.
export interface RulerPinch {
  readonly key: string;
  readonly center: { readonly x: number; readonly y: number };
  readonly angle: number | null;
}

export interface RulerContext {
  /// Il righello sul foglio; `null` se non c'è.
  ruler: Ruler | null;
  /// Mette o toglie il righello.
  setRuler: (on: boolean) => void;
  /// Gira il righello al passo di 15° dopo, o lo raddrizza con `0`.
  stepRuler: (direction: 1 | -1 | 0) => void;
  /// Il righello sotto il puntatore appena sceso prende il gesto.
  rulerStart: (base: GestureBase) => RulerGesture | null;
  rulerUpdate: (g: RulerGesture, p: Point) => void;
  rulerEnd: (g: RulerGesture) => void;
  rulerCancel: (g: RulerGesture) => void;
  /// Il bordo che segue un tratto col pennello `brush` nel livello `to`,
  /// cominciato dove il puntatore è sceso; `null` lontano dal righello.
  rulerEdgeAt: (pointer: InkPointerType, brush: InkBrush, to: Destination) => RulerEdge | null;
  /// Il campione `sample` della scena lungo `edge`, se c'è.
  ruled: (sample: InkSample, edge: RulerEdge | null) => InkSample;
  rulerHandles: () => OverlayHandle[];
  hoverRuler: (p: Point | null, pointer: InkPointerType) => void;
  /// La rotella in `clientX`, `clientY` sopra il righello lo gira: vero se
  /// l'ha presa.
  rulerWheel: (clientX: number, clientY: number, delta: number, shift: boolean) => boolean;
  /// Le dita da `prev` a `next`: vero se muovono il righello e non la vista.
  rulerPinch: (prev: RulerPinch | null, next: RulerPinch | null) => boolean;
}

export function installRuler(ctx: EditorContext): void {
  const { announce, showHandles, showGrip } = ctx;
  ctx.ruler = null;

  /// Mezza larghezza del righello, nella scena.
  const half = (): number => RULER_WIDTH_PX / 2 / ctx.camera.scale;
  const reach = (pointer: InkPointerType): number => RULER_REACH_PX[pointer] / ctx.camera.scale;
  const angleSaid = (ruler: Ruler): string => t("draw.ruler.angle", { angle: String(rulerDegrees(ruler)) });

  const place = (next: Ruler | null): void => {
    ctx.ruler = next;
    showHandles();
  };

  const setRuler = (on: boolean): void => {
    if (on === (ctx.ruler !== null)) return;
    if (!on) {
      place(null);
      announce(t("draw.ruler.hidden"));
      return;
    }
    // In mezzo a ciò che si vede, dritto sullo schermo anche col foglio girato.
    const next: Ruler = { center: toScene(ctx.camera, ctx.viewCenter()), angle: normalTurn(-ctx.camera.angle) };
    place(next);
    announce(t("draw.ruler.shown", { angle: String(rulerDegrees(next)) }));
  };
  ctx.setRuler = setRuler;

  const stepRuler = (direction: 1 | -1 | 0): void => {
    const ruler = ctx.ruler;
    if (ruler === null) return;
    const next = direction === 0 ? { ...ruler, angle: normalTurn(-ctx.camera.angle) } : steppedRuler(ruler, direction);
    place(next);
    announce(angleSaid(next));
  };
  ctx.stepRuler = stepRuler;

  const rulerStart = (base: GestureBase): RulerGesture | null => {
    const ruler = ctx.ruler;
    const down = ctx.downAt;
    if (ruler === null || down === null) return null;
    const p = toScene(ctx.camera, down);
    if (!onRulerBody(ruler, p, half(), reach(base.pointer))) return null;
    return { ...base, kind: "ruler", from: down, offset: [ruler.center[0] - p[0], ruler.center[1] - p[1]], before: ruler, moved: false };
  };
  ctx.rulerStart = rulerStart;

  /// Il righello segue il puntatore in `p`, nella scena, oltre il tremito
  /// della mano.
  const rulerUpdate = (g: RulerGesture, p: Point): void => {
    const ruler = ctx.ruler;
    if (ruler === null) return;
    const [x, y] = toScreen(ctx.camera, p);
    if (!g.moved && Math.hypot(x - g.from[0], y - g.from[1]) <= DRAG_PX[g.pointer]) return;
    if (!g.moved) showGrip("move");
    g.moved = true;
    place({ ...ruler, center: [p[0] + g.offset[0], p[1] + g.offset[1]] });
  };
  ctx.rulerUpdate = rulerUpdate;

  const rulerEnd = (g: RulerGesture): void => {
    ctx.current = null;
    showGrip(null);
    showHandles();
    if (g.moved) announce(t("draw.ruler.moved"));
  };
  ctx.rulerEnd = rulerEnd;

  const rulerCancel = (g: RulerGesture): void => {
    showGrip(null);
    if (ctx.ruler !== null) place(g.before);
  };
  ctx.rulerCancel = rulerCancel;

  const rulerEdgeAt = (pointer: InkPointerType, brush: InkBrush, to: Destination): RulerEdge | null => {
    const ruler = ctx.ruler;
    const down = ctx.downAt;
    if (ruler === null || down === null) return null;
    // Mezza punta, portata dal livello alla scena.
    const offset = (brush.size / 2) * scaleOf(to.matrix);
    return rulerEdge(ruler, toScene(ctx.camera, down), half(), reach(pointer), offset);
  };
  ctx.rulerEdgeAt = rulerEdgeAt;

  ctx.ruled = (sample, edge) => (edge === null ? sample : alongEdge(sample, edge));

  const rulerHandles = (): OverlayHandle[] => {
    const ruler = ctx.ruler;
    if (ruler === null) return [];
    const active = ctx.current?.kind === "ruler" && ctx.current.moved;
    return [{ kind: "ruler", center: ruler.center, angle: ruler.angle, width: RULER_WIDTH_PX, text: `${rulerDegrees(ruler)}°`, active }];
  };
  ctx.rulerHandles = rulerHandles;

  const hoverRuler = (p: Point | null, pointer: InkPointerType): void => {
    const ruler = ctx.ruler;
    if (p !== null && ruler !== null && onRulerBody(ruler, p, half(), reach(pointer))) showGrip("move");
  };
  ctx.hoverRuler = hoverRuler;

  /// La rotella raccolta finché non fa un passo con Maiusc.
  let wheel = 0;
  const rulerWheel = (clientX: number, clientY: number, delta: number, shift: boolean): boolean => {
    const ruler = ctx.ruler;
    if (ruler === null || delta === 0 || !onRuler(ruler, ctx.sceneAt(clientX, clientY), half())) return false;
    let next: Ruler;
    if (shift) {
      wheel += delta;
      if (Math.abs(wheel) < WHEEL_PER_STEP) return true;
      next = steppedRuler(ruler, wheel > 0 ? 1 : -1);
      wheel = 0;
    } else {
      next = turnedRuler(ruler, Math.max(-5, Math.min(5, delta / WHEEL_PER_DEGREE)));
    }
    place(next);
    announce(angleSaid(next));
    return true;
  };
  ctx.rulerWheel = rulerWheel;

  /// Le dita appoggiate sopra il righello lo tengono finché restano quelle.
  let held: string | null = null;
  const rulerPinch = (prev: RulerPinch | null, next: RulerPinch | null): boolean => {
    const ruler = ctx.ruler;
    if (ruler === null || next === null || next.angle === null) {
      if (held !== null && ruler !== null) {
        const settled = { ...ruler, angle: Math.round(ruler.angle) };
        place(settled);
        announce(angleSaid(settled));
      }
      held = null;
      return false;
    }
    if (prev === null || prev.key !== next.key || prev.angle === null) {
      held = onRuler(ruler, toScene(ctx.camera, [next.center.x, next.center.y]), half()) ? next.key : null;
      return held !== null;
    }
    if (held !== next.key) return false;
    const from = toScene(ctx.camera, [prev.center.x, prev.center.y]);
    const to = toScene(ctx.camera, [next.center.x, next.center.y]);
    const turned = turnedRuler(ruler, normalTurn(next.angle - prev.angle));
    place({ ...turned, center: [ruler.center[0] + to[0] - from[0], ruler.center[1] + to[1] - from[1]] });
    return true;
  };
  ctx.rulerPinch = rulerPinch;
}
