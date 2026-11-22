// Le righe `view.*` di ≡ › Visualizza del Disegno completo (K6 T11, giro E). Lo stato
// è della superficie, non del file. Griglia e aggancio sono quelli del Semplice (lo
// stesso `changeGrid`, così restano uguali fra i due spazi); il contorno è la vista
// del contorno; i righelli di bordo stanno in `edge-rulers.ts`; la rotazione è
// quella della vista. Una voce che il client non fa non è qui: resta «da fare» in
// mappa, con la nota del perché.

import { t } from "../../../strings";
import type { EditorContext } from "../context";

export const COMANDI_VISUALIZZA = ["view.grid", "view.snapToGrid", "view.outline", "view.rulers", "view.rotateReset"] as const;
export type ComandoVisualizza = (typeof COMANDI_VISUALIZZA)[number];

/// Le file di ≡ › Visualizza, in ordine, con una riga di separazione fra l'una e
/// l'altra: griglia e aggancio, poi come si vede il disegno (contorno, righelli),
/// poi la rotazione della vista.
export const FILE_VISUALIZZA: readonly (readonly ComandoVisualizza[])[] = [
  ["view.grid", "view.snapToGrid"],
  ["view.outline", "view.rulers"],
  ["view.rotateReset"],
];

export function isComandoVisualizza(id: string): id is ComandoVisualizza {
  return (COMANDI_VISUALIZZA as readonly string[]).includes(id);
}

/// La voce del Completo: `null` se il client la fa, il perché se è spenta adesso,
/// `undefined` se non è una delle sue.
export function voceVisualizza(ctx: EditorContext, id: string): string | null | undefined {
  if (!isComandoVisualizza(id)) return undefined;
  if (id === "view.rotateReset" && ctx.camera.angle === 0) return t("draw.view.not_turned");
  return null;
}

/// Lo stato con la spunta di una voce, `undefined` se la voce non ne ha.
export function statoVisualizza(ctx: EditorContext, id: string): boolean | undefined {
  switch (id) {
    case "view.grid":
      return ctx.grid.shown;
    case "view.snapToGrid":
      return ctx.grid.snap;
    case "view.outline":
      return ctx.outline;
    case "view.rulers":
      return ctx.edgeRulers;
    default:
      return undefined;
  }
}

/// Fa il comando `id`: ogni scelta cambia lo stato della superficie, e un solo passo
/// dove ce n'è uno (la griglia non va nella cronologia del file).
export function comandoVisualizza(ctx: EditorContext, id: ComandoVisualizza): void {
  switch (id) {
    case "view.grid":
      ctx.changeGrid({ ...ctx.grid, shown: !ctx.grid.shown });
      return;
    case "view.snapToGrid":
      ctx.changeGrid({ ...ctx.grid, snap: !ctx.grid.snap });
      return;
    case "view.outline":
      ctx.setOutline(!ctx.outline);
      return;
    case "view.rulers":
      ctx.setEdgeRulers(!ctx.edgeRulers);
      return;
    case "view.rotateReset":
      ctx.turnView(0);
      return;
  }
}
