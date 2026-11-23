// «Usa cursori di precisione» del Disegno completo (K6 T11, cursori; ≡ › Visualizza):
// la croce al posto del cursore degli strumenti che disegnano
// (`STRUMENTI_CHE_DISEGNANO`, in `motore/strumento.ts`). La scelta è dello stato di
// vista della macchina, come la griglia (`preferences.ts`): non entra nel file né
// nella cronologia. Chi la cambia la vede solo quando la scrittura riesce: se non
// riesce, la voce resta com'era e lo si dice. Il cursore lo rimette
// `applyToolCursor` (`motore/gesti.ts`), che sa quale strumento è scelto.

import { t } from "../../strings";
import type { EditorContext } from "./context";

/// Il comando della voce. `onChange` scrive la scelta e dice se è riuscita; senza
/// `onChange` la scelta vale subito.
export function installPreciseCursors(ctx: EditorContext, onChange?: (on: boolean) => Promise<boolean>): void {
  ctx.setPreciseCursors = (on) => {
    if (ctx.disposed || ctx.preciseCursors === on) return;
    const scritta = onChange === undefined ? Promise.resolve(true) : onChange(on);
    void scritta.then((ok) => {
      if (!ok || ctx.disposed) return;
      ctx.preciseCursors = on;
      ctx.applyToolCursor();
      ctx.announce(t(on ? "draw.view.preciseCursors.on" : "draw.view.preciseCursors.off"));
    });
  };
}
