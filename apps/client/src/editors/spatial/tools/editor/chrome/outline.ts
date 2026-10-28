// La vista dei contorni (D4): Ctrl+Y mostra ogni tracciato come un filo di
// un pixel, senza riempimenti né effetti, per trovare ciò che sta sotto o è
// nascosto da una sfumatura; lo stesso tasto torna al disegno pieno. Il
// disegno non cambia, e la banda di stato dice che la vista è questa.

import { t } from "../../../strings";
import type { EditorContext } from "../context";

export interface OutlineContext {
  /// La vista dei contorni è accesa.
  outline: boolean;
  setOutline: (on: boolean) => void;
}

export function installOutline(ctx: EditorContext): void {
  ctx.outline = false;
  ctx.setOutline = (on) => {
    if (ctx.outline === on || ctx.disposed) return;
    ctx.outline = on;
    ctx.painter.setOutline(on);
    ctx.root.toggleAttribute("data-outline", on);
    ctx.statusChanged();
    ctx.announce(t(on ? "draw.outline.on" : "draw.outline.off"));
  };
}
