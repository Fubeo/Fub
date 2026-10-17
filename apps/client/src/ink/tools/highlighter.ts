// L'evidenziatore: la penna a scalpello che si vede attraverso.
//
// Spessore costante e punte piatte, come un pennarello: la pressione non lo
// cambia, e per questo il suo pennello non cambia con il dispositivo. Con il
// tasto di raddrizzamento va dritto dal primo all'ultimo punto, e copre al
// 40%: è l'opacità che il file scrive nel riempimento.

import { PF1_DEFAULTS } from "../brush";
import { joined, type StrokeTool } from "./tool";

/// Quanto copre l'evidenziatore.
export const HIGHLIGHTER_OPACITY = 0.4;

export const HIGHLIGHTER: StrokeTool = {
  kind: "stroke",
  id: "highlighter",
  opacity: HIGHLIGHTER_OPACITY,
  capabilities: {
    pressure: false,
    straightWithModifier: true,
    symmetry: true,
    holdsToShape: false,
    stabilizes: true,
  },
  brush: (width, input) =>
    joined({ ...PF1_DEFAULTS, size: width, thinning: 0, capStart: false, capEnd: false, sim: false }, input),
};
