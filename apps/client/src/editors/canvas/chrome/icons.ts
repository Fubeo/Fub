// Le icone della lavagna: le figure `canvas-…` che il disegno non ha, col
// tratto delle icone della shell (griglia di 24, soltanto tracciati, estremi
// tondi). Gli strumenti che la lavagna ha in comune col disegno usano le sue
// (`draw-select`, `draw-pen`, …: `editors/spatial/icons.ts`), così le due
// colonne si somigliano e un tema le ridisegna una volta sola.
//
// Si registrano una volta per tutte le lavagne, alla prima che le chiede, e
// restano finché la shell vive, come quelle del disegno.

import { icon, registerIcon } from "../../../ui/icons";
import { ensureDrawIcons } from "../../spatial/icons";

const CANVAS_ICONS: Readonly<Record<string, readonly string[]>> = {
  // Testo: la T della barra del formato (`fmt-text`), col nome suo, perché
  // quella si registra solo quando la barra c'è e la colonna restava vuota.
  "canvas-text": ["M6 6h12M12 6v13"],
  // Collega: due schede e il filo che va dall'una all'altra.
  "canvas-connect": [
    "M4.5 4h4a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 3 8.5v-3A1.5 1.5 0 0 1 4.5 4z",
    "M15.5 14h4a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-3a1.5 1.5 0 0 1 1.5-1.5z",
    "M10 7h2.5a2 2 0 0 1 2 2v5",
  ],
};

/// Registra le icone della lavagna e quelle del disegno che la colonna usa.
export function ensureCanvasIcons(): void {
  ensureDrawIcons();
  for (const [name, paths] of Object.entries(CANVAS_ICONS)) if (icon(name) === "") registerIcon(name, paths);
}
