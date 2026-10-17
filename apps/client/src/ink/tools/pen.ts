// La penna: lo strumento che scrive con lo spessore della pressione.
//
// È lo strumento che FubDraw aveva dentro il suo editor; qui è un pezzo di
// sistema, e ne dipendono tutti i prodotti che scrivono a mano. La ricetta è
// quella di sempre: `pf1` coi valori di perfect-freehand, e `sim` solo se il
// dispositivo non dà la pressione (mouse, dito), perché allora la velocità
// la finge e `fub:brush` lo deve dire (formato della scena, §5).

import { brushForInput, PF1_DEFAULTS } from "../brush";
import { joined, type StrokeTool } from "./tool";

export const PEN: StrokeTool = {
  kind: "stroke",
  id: "pen",
  opacity: 1,
  capabilities: {
    pressure: true,
    straightWithModifier: false,
    symmetry: true,
    holdsToShape: true,
    stabilizes: true,
  },
  brush: (width, input) => joined(brushForInput({ ...PF1_DEFAULTS, size: width, sim: false }, input.pressure), input),
};
