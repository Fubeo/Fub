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
  // Lazo (T86): il giro della corda, il nodo e il capo che pende.
  "canvas-lasso": [
    "M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5z",
    "M7.5 13.2c-.9 1-1.3 2-1 3 .4 1.6 2.4 2.1 3.7 1.2",
    "M10.2 17.4 9 20.5",
  ],
  // Il dito scrive (T64): la mano con l'indice teso, la figura del prototipo.
  "canvas-finger": [
    "M9 11V5.5a1.5 1.5 0 0 1 3 0V11",
    "M12 10.5V9a1.5 1.5 0 0 1 3 0v2",
    "M15 10.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a5 5 0 0 1-3.9-1.9L5 15.2a1.5 1.5 0 0 1 2.3-1.9L9 15",
  ],
  // Il righello (T87): la riga di traverso con le tacche lungo un bordo.
  "canvas-ruler": [
    "M3.5 16.5 16.5 3.5l4 4-13 13z",
    "M6 14l1.5 1.5",
    "M9 11l2.5 2.5",
    "M12 8l1.5 1.5",
    "M15 5l2.5 2.5",
  ],
  // Cerca nella lavagna (T60): il risultato precedente e il seguente, le
  // frecce del prototipo.
  "canvas-find-previous": ["M19 12H5", "M11 6l-6 6 6 6"],
  "canvas-find-next": ["M5 12h14", "M13 6l6 6-6 6"],
};

/// Registra le icone della lavagna e quelle del disegno che la colonna usa.
export function ensureCanvasIcons(): void {
  ensureDrawIcons();
  for (const [name, paths] of Object.entries(CANVAS_ICONS)) if (icon(name) === "") registerIcon(name, paths);
}
