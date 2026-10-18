// Ciò che la cornice dello Scrittoio ha in più su un telefono.
//
// La geometria è di `mobile.css`, importato dall'ingresso. Qui si montano i
// comportamenti che un foglio di stile non può dare.
import type { Lifetime } from "../../../ui/lifetime";
import { mountBottomBar } from "./bottom-bar";
import { mountBottomSheets } from "./bottom-sheets";

export function mountMobileFrame(lifetime: Lifetime): void {
  mountBottomBar(lifetime);
  mountBottomSheets(lifetime);
}
