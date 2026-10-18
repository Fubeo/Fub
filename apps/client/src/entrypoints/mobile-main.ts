import { nativeMobileBridge } from "../host/ipc";
import { startupMobile } from "./mobile";
// I fogli di struttura sono dell'ingresso. Vengono dopo l'import mobile, così
// `mobile.css` li precede; quello del telefono viene per ultimo e scrive sopra
// la struttura dello Scrittoio soltanto ciò che su un telefono cambia.
import "../theme/scrittoio/structure.css";
import "../shells/scrittoio/mobile/mobile.css";

// La build mobile sceglie questo ingresso: non valuta mai quello desktop.
export const startup = startupMobile(nativeMobileBridge());
