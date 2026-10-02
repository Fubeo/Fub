// Le modalità di una superficie, viste dai comandi della shell.
//
// `shell.mode.reading` (`Mod-e`), `shell.mode.live` e `shell.mode.source`
// nominano un **ruolo**, non un id: la lettura, la scrittura su una resa, il
// sorgente com'è scritto. Ogni superficie dichiara il ruolo delle proprie
// modalità in `SurfaceMode.contextMode`, ed è lì che i comandi lo cercano: la
// tela chiama «canvas» la sua scrittura su una resa, un profilo nuovo può
// chiamare «draw» e «read» le sue due, e i comandi le trovano senza che la
// shell ne conosca il nome.
//
// Un comando è disponibile soltanto dove porterebbe a qualcosa: una
// superficie con una modalità sola non ne offre nessuno, e il toggle chiede
// una lettura e almeno una scrittura fra cui alternare. La disponibilità è
// della superficie, non della modalità corrente: «Passa a Live» resta
// nell'elenco anche stando già in Live, come il bottone attivo del
// commutatore, perché una scorciatoia assegnata dall'utente che sparisse a
// seconda della modalità ricadrebbe sull'editor sotto, con un effetto diverso.

import type { PaneMode } from "../../host/contract";
import type { SurfaceMode } from "./registry";

/// La superficie ha più di una modalità, e una di queste ha il ruolo chiesto.
export function offersContext(modes: readonly SurfaceMode[], context: PaneMode): boolean {
  return modes.length > 1 && modes.some((mode) => mode.contextMode === context);
}

/// La modalità che un comando di ruolo raggiunge: quella corrente, se ha già
/// quel ruolo (due modalità con lo stesso ruolo non si scavalcano a vicenda),
/// altrimenti la prima dichiarata con quel ruolo. `undefined` dove il ruolo
/// non c'è.
export function modeForContext(
  modes: readonly SurfaceMode[],
  current: string | undefined,
  context: PaneMode,
): SurfaceMode | undefined {
  const here = modes.find((mode) => mode.id === current);
  if (here?.contextMode === context) return here;
  return modes.find((mode) => mode.contextMode === context);
}

/// Il toggle della lettura ha fra cosa alternare: almeno una modalità di
/// lettura e almeno una che non lo è.
export function offersReadingToggle(modes: readonly SurfaceMode[]): boolean {
  return modes.some((mode) => mode.contextMode === "reading")
    && modes.some((mode) => mode.contextMode !== "reading");
}

/// Dove porta `Mod-e`. Da una scrittura, alla prima lettura dichiarata. Dalla
/// lettura, alla scrittura da cui si era partiti in quel riquadro (`remembered`);
/// se quella superficie non la dichiara — il riquadro ha cambiato documento, o
/// il profilo — alla sua predefinita quando è una scrittura, e altrimenti alla
/// prima scrittura che dichiara. Mai a un id scritto qui: la shell non sa come
/// una superficie chiama le sue modalità.
export function readingToggleTarget(
  modes: readonly SurfaceMode[],
  current: string | undefined,
  remembered: string | undefined,
  defaultMode: string | undefined,
): SurfaceMode | undefined {
  if (!offersReadingToggle(modes)) return undefined;
  const here = modes.find((mode) => mode.id === current);
  if (here?.contextMode !== "reading") return modes.find((mode) => mode.contextMode === "reading");
  const writing = (id: string | undefined) =>
    modes.find((mode) => mode.id === id && mode.contextMode !== "reading");
  return writing(remembered)
    ?? writing(defaultMode)
    ?? modes.find((mode) => mode.contextMode !== "reading");
}
