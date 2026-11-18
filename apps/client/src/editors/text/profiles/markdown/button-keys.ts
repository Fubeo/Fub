// I tasti di un pulsante dentro la resa di una nota.
//
// Nella Live la resa di un'immagine (o di una pagina incorporata) è un widget
// dentro l'editor, e il widget lascia arrivare a CodeMirror gli eventi che
// non ignora: un tasto premuto col fuoco su un suo pulsante salirebbe fino
// all'editor, e Invio, Spazio o Tab scriverebbero nella nota un a capo, uno
// spazio o un rientro (#454). Quei tasti sono del pulsante: il clic e il passo
// di fuoco del browser.

import type { Lifetime } from "../../../../ui/lifetime";

/// I tasti che un pulsante fa da sé: il clic e il passo di fuoco.
const BUTTON_KEYS = new Set(["Enter", " ", "Tab"]);

/// Tiene sul pulsante Invio, Spazio e Tab (anche con Maiusc): non salgono
/// all'editor che lo contiene. Le scorciatoie con Ctrl, Cmd o Alt, ed Esc,
/// passano alla finestra.
export function keepButtonKeys(button: HTMLButtonElement, life: Lifetime): void {
  life.listen(button, "keydown", (event) => {
    if (BUTTON_KEYS.has(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
  });
}
