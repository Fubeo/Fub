// La gomma: lo strumento che cancella ciò che il puntatore attraversa.
//
// È il secondo genere di strumento dell'inchiostro. Non scrive campioni: il
// suo gesto è un tratto che *segna* ciò che incontra, e il prodotto cancella
// ciò che ha segnato quando il puntatore si alza (vedi `sweep.ts`).

import type { InkPointerType } from "../input/pointer";
import type { EraseTool } from "./tool";

/// Il raggio della gomma in pixel dello schermo, per dispositivo.
const RADIUS_PX: Readonly<Record<InkPointerType, number>> = { pen: 8, mouse: 8, touch: 16 };

export const ERASER: EraseTool = {
  kind: "erase",
  id: "eraser",
  radius: (pointer) => RADIUS_PX[pointer],
};
