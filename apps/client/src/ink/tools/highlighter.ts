// L'evidenziatore: la penna a scalpello che si vede attraverso.
//
// Spessore costante e punte piatte, come un pennarello: la pressione non lo
// cambia, e per questo il suo pennello non cambia con il dispositivo. Con il
// tasto di raddrizzamento va dritto dal primo all'ultimo punto. Copre a metà e
// moltiplica ciò che sta sotto (`mix-blend-mode: multiply`): il nero resta nero.

import { PENS, penBrush } from "../pens";
import { joined, type StrokeTool } from "./tool";

/// Quanto copre l'evidenziatore.
export const HIGHLIGHTER_OPACITY = PENS.highlighter.opacity;

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
  pens: ["highlighter"],
  brush: (width, input) => joined(penBrush("highlighter", width, input.pressure), input),
};
