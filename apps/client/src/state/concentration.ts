// La concentrazione della finestra: cassetti, linguette e barra si ritirano e
// resta il foglio. La accende e la spegne la shell (`desktop-shell.ts`, che la
// scrive anche come `data-focus-mode` su `#app`, per la pelle); qui la legge
// chi sta sotto la shell e non deve conoscerne il DOM: il tasto Esc dei
// Blocchi, che in concentrazione lascia Esc alla shell perché ne esca, e gli
// editor di testo, che segnano il blocco del cursore
// (`editors/text/cursor-block.ts`).

import { composingKey } from "../kit/ime";

let on = false;
const listeners = new Set<(on: boolean) => void>();

/// La finestra è in concentrazione.
export function concentrating(): boolean {
  return on;
}

/// Lo scrive soltanto la shell, quando entra o esce. Chi ascolta lo sa
/// soltanto quando cambia davvero.
export function setConcentrating(next: boolean): void {
  if (on === next) return;
  on = next;
  for (const listener of [...listeners]) listener(on);
}

/// Ascolta i cambi; restituisce chi smette.
export function onConcentration(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Esc fa uscire dalla concentrazione soltanto se nessuno l'ha già preso: un
/// menu, un dialogo o un fumetto aperti si chiudono prima (lo prendono in
/// cattura), l'editor lo prende per i suoi tasti (Vim compreso). Senza
/// modificatori e fuori da una composizione.
export function escapeLeavesConcentration(event: KeyboardEvent): boolean {
  if (!on || event.key !== "Escape" || event.defaultPrevented || composingKey(event)) return false;
  return !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);
}
