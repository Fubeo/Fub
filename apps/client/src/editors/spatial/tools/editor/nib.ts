// L'editor del disegno: la punta che si vede (P4). Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.
//
// Con la Penna, l'Evidenziatore e la Gomma il puntatore sospeso sopra il
// foglio è il contorno della punta, alla misura vera e alla scala della
// vista: un cerchio per le penne tonde, l'ellisse stretta e girata della
// Calligrafia, il rettangolo tondo dell'evidenziatore, il cerchio tratteggiato
// della gomma; col mirino in mezzo. Durante il tratto si nasconde: si vede
// l'inchiostro. Il dito non è sospeso, e non ha punta.
//
// Con lo stabilizzatore a corda (P5), durante il tratto si vede la corda: dal
// pennino, dove arriva l'inchiostro, al puntatore che lo tira.
//
// `[` e `]` stringono e allargano la punta di 0,8× e 1,25×: con la Penna e
// l'Evidenziatore vincono sulla rotazione della selezione.

import { isNib1 } from "../../../../ink/brush";
import type { InkPointerType } from "../../../../ink/input/pointer";
import { MAX_PEN_SIZE, MIN_PEN_SIZE, penBrush } from "../../../../ink/pens";
import { INK_TOOLS } from "../../../../ink/tools/registry";
import type { OverlayHandle } from "../../painter/overlay";
import type { Point } from "../../scene/matrix";
import { formatNumber } from "../../number";
import { t } from "../../strings";
import type { EditorContext } from "./context";

/// Dove sta la penna sospesa, e di che puntatore è.
export interface NibHover {
  readonly at: Point;
  readonly pointer: InkPointerType;
}

export interface NibContext {
  nibHover: NibHover | null;
  /// Il puntatore passa sopra `p` senza premere; `null` se se ne va.
  hoverNib: (p: Point | null, pointer: InkPointerType) => void;
  /// La punta da disegnare sopra il foglio, se ce n'è una.
  nibHandles: () => OverlayHandle[];
  /// `[` (−1) e `]` (+1): la punta più stretta o più larga. Vero se il tasto
  /// era suo.
  stepNib: (direction: -1 | 1) => boolean;
}

/// Quanto cambia la misura a ogni passo di `[` e `]`.
const NIB_SHRINK = 0.8;
const NIB_GROW = 1.25;

/// La misura del passo da `width` verso `direction`, a due decimali, fra 0,25
/// e 200.
export function steppedSize(width: number, direction: -1 | 1): number {
  const next = Math.round(width * (direction < 0 ? NIB_SHRINK : NIB_GROW) * 100) / 100;
  return Math.min(MAX_PEN_SIZE, Math.max(MIN_PEN_SIZE, next));
}

export function installNib(ctx: EditorContext): void {
  const { surface } = ctx;
  ctx.nibHover = null;

  const inking = (): boolean => ctx.tool === "pen" || ctx.tool === "highlighter" || ctx.tool === "eraser";

  const hoverNib = (p: Point | null, pointer: InkPointerType): void => {
    const next = p !== null && pointer !== "touch" && inking() && ctx.editable() ? { at: p, pointer } : null;
    if (next === null && ctx.nibHover === null) return;
    ctx.nibHover = next;
    surface.toggleAttribute("data-nib", next !== null);
    ctx.showHandles();
  };
  ctx.hoverNib = hoverNib;
  // Il tratto comincia: la punta torna al passaggio dopo.
  ctx.life.listen(surface, "pointerdown", () => hoverNib(null, "mouse"));

  /// La corda: c'è con lo stabilizzatore a corda, mentre si disegna.
  const roped = (): boolean => ctx.current?.kind === "ink" && ctx.has("gestures") && ctx.grid.steady !== undefined && ctx.grid.steady.amount > 0 && ctx.grid.steady.string;
  ctx.life.listen(surface, "pointermove", () => {
    if (roped()) ctx.showHandles();
  });

  const nibHandles = (): OverlayHandle[] => {
    const g = ctx.current;
    if (g?.kind === "ink" && roped() && ctx.pointerAt !== null) {
      const last = g.scene[g.scene.length - 1];
      return last === undefined ? [] : [{ kind: "guide", from: [last.x, last.y], to: ctx.pointerAt.at, dashed: true }];
    }
    const hovered = ctx.nibHover;
    if (hovered === null || ctx.current !== null || ctx.pressed !== null || !inking() || !ctx.editable()) {
      surface.removeAttribute("data-nib");
      return [];
    }
    surface.setAttribute("data-nib", "");
    const [x, y] = hovered.at;
    if (ctx.tool === "eraser") {
      const radius = INK_TOOLS.erase("eraser")?.radius(hovered.pointer) ?? 0;
      return [{ kind: "nib", x, y, shape: "eraser", width: 2 * radius, height: 2 * radius, angle: 0 }];
    }
    const { width } = ctx.style();
    if (ctx.tool === "highlighter") return [{ kind: "nib", x, y, shape: "block", width, height: width, angle: 0 }];
    const brush = penBrush(ctx.penId, width, hovered.pointer === "pen");
    if (isNib1(brush)) return [{ kind: "nib", x, y, shape: "flat", width: brush.size, height: brush.tip, angle: brush.angle }];
    return [{ kind: "nib", x, y, shape: "round", width, height: width, angle: 0 }];
  };
  ctx.nibHandles = nibHandles;

  const stepNib = (direction: -1 | 1): boolean => {
    if (ctx.tool !== "pen" && ctx.tool !== "highlighter") return false;
    if (!ctx.editable() || ctx.current !== null || ctx.pressed !== null) return true;
    const before = ctx.style().width;
    const next = steppedSize(before, direction);
    if (next !== before) {
      ctx.setWidth(next);
      ctx.syncPenOptions();
      ctx.showHandles();
    }
    ctx.announce(t("draw.pen.size.now", { size: formatNumber(ctx.style().width, 2) }));
    return true;
  };
  ctx.stepNib = stepNib;
}
