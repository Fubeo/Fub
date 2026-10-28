// La penna: lo strumento che scrive con lo spessore della pressione.
//
// È lo strumento che FubDraw aveva dentro il suo editor; qui è un pezzo di
// sistema, e ne dipendono tutti i prodotti che scrivono a mano. Scrive con
// una delle penne di sistema (`pens.ts`), la Sfera se non se ne sceglie
// un'altra; `sim` solo se il dispositivo non dà la pressione (mouse, dito),
// perché allora la velocità la finge e `fub:brush` lo deve dire (formato della
// scena, §5).

import { DEFAULT_PEN, PEN_IDS, PENS, penBrush, type PenId } from "../pens";
import { joined, type StrokeTool } from "./tool";

const OWN: readonly PenId[] = PEN_IDS.filter((id) => PENS[id].tool === "pen");

export const PEN: StrokeTool = {
  kind: "stroke",
  id: "pen",
  opacity: PENS[DEFAULT_PEN].opacity,
  capabilities: {
    pressure: true,
    straightWithModifier: true,
    symmetry: true,
    holdsToShape: true,
    stabilizes: true,
  },
  pens: [DEFAULT_PEN, ...OWN.filter((id) => id !== DEFAULT_PEN)],
  brush: (width, input, pen) => joined(penBrush(pen !== undefined && OWN.includes(pen) ? pen : DEFAULT_PEN, width, input.pressure), input),
};
