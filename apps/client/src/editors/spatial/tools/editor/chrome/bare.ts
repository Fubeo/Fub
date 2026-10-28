// Nascondi l'interfaccia (D8): Ctrl+. toglie la colonna degli strumenti, la
// riga delle opzioni e la barra della selezione, e lascia il foglio; lo
// stesso tasto le riporta. La vista e il disegno non cambiano.

import { t } from "../../../strings";
import type { EditorContext } from "../context";

export interface BareContext {
  /// L'interfaccia del disegno è nascosta.
  bare: boolean;
  setBare: (on: boolean) => void;
}

export function installBare(ctx: EditorContext): void {
  ctx.bare = false;
  ctx.setBare = (on) => {
    if (ctx.bare === on) return;
    ctx.bare = on;
    // Il fuoco dentro ciò che sparisce torna al foglio.
    const lost = on && ctx.root.contains(document.activeElement) && !ctx.surface.contains(document.activeElement);
    ctx.root.toggleAttribute("data-bare", on);
    if (lost) ctx.surface.focus({ preventScroll: true });
    ctx.placeBar();
    ctx.announce(t(on ? "draw.bare.on" : "draw.bare.off"));
  };
}
