// La banda di stato del disegno (E1): lo zoom, dove sta il puntatore, le
// misure della selezione, quanti oggetti, la vista girata. Chi ospita
// l'editor la legge con `items()` e la ridisegna a ogni `subscribe`: nello
// Scrittoio è lo `status` della superficie, al posto delle parole.

import { plural, t } from "../../../strings";
import type { Point } from "../../../scene/matrix";
import type { EditorContext } from "../context";

/// Una voce della banda: un fatto, e se c'è che cosa fa un clic.
export interface DrawStatusItem {
  readonly id: string;
  readonly text: string;
  readonly hint?: string;
  readonly open?: () => void;
}

export interface DrawStatus {
  items(): readonly DrawStatusItem[];
  /// Avvisa quando una voce può essere cambiata.
  subscribe(listener: () => void): () => void;
}

export interface StatusContext {
  status: DrawStatus;
  /// Dove sta il puntatore sul foglio, nella scena; `null` fuori.
  statusPointer: Point | null;
  /// Una voce può essere cambiata: la vista, la selezione, il puntatore.
  statusChanged: () => void;
}

/// La misura lungo un lato di una cornice con la matrice `[a, b, c, d]`.
const along = (length: number, x: number, y: number): number => length * Math.hypot(x, y);

export function installStatus(ctx: EditorContext): void {
  const listeners = new Set<() => void>();
  ctx.statusPointer = null;
  ctx.statusChanged = () => {
    for (const listener of [...listeners]) listener();
  };
  ctx.life.add(() => listeners.clear());

  const items = (): DrawStatusItem[] => {
    if (ctx.disposed) return [];
    const list: DrawStatusItem[] = [];
    const zoom = ctx.zoomText();
    list.push({ id: "zoom", text: zoom, hint: t("draw.zoom_reset", { zoom }), open: () => ctx.zoomBy(1 / ctx.camera.scale) });
    if (ctx.camera.angle !== 0) {
      const angle = ctx.turnText(ctx.camera.angle);
      list.push({ id: "turn", text: t("draw.status.turn", { angle }), hint: t("draw.turn.button", { angle }), open: () => ctx.turnView(0) });
    }
    if (ctx.outline) list.push({ id: "outline", text: t("draw.outlines"), hint: t("draw.status.outline.hint"), open: () => ctx.setOutline(false) });
    if (ctx.statusPointer !== null) {
      list.push({ id: "pointer", text: t("draw.status.pointer", { x: ctx.coordText(ctx.statusPointer[0]), y: ctx.coordText(ctx.statusPointer[1]) }), hint: t("draw.status.pointer.hint") });
    }
    const count = ctx.currentIndex().units.length;
    const chosen = ctx.selectedUnits();
    if (chosen.length > 0) {
      const frame = ctx.frameOf(chosen);
      if (frame !== null) {
        const [a, b, c, d] = frame.matrix;
        const width = ctx.lengthText(along(frame.box.max[0] - frame.box.min[0], a, b));
        const height = ctx.lengthText(along(frame.box.max[1] - frame.box.min[1], c, d));
        list.push({ id: "size", text: t("draw.status.size", { width, height }), hint: t("draw.status.size.hint") });
      }
      list.push({ id: "objects", text: t("draw.status.chosen", { chosen: chosen.length, count }), hint: t("draw.status.objects.hint") });
    } else {
      list.push({ id: "objects", text: plural(count, "draw.status.objects.one", "draw.status.objects.other"), hint: t("draw.status.objects.hint") });
    }
    return list;
  };

  ctx.status = {
    items,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
