// Un comando sul posto: il clic col puntatore non porta via il fuoco.
//
// Il clic su un bottone gli dà il fuoco (WebKitGTK, Chromium, Firefox su
// Linux), e chi stava scrivendo lo perde: le battute che seguono vanno al
// bottone e non entrano nella nota (IMP-6401). Un bottone che agisce sull'app
// senza aprire niente (la luce, l'adattamento della carta, lo zoom al 100%)
// lascia il fuoco dov'era, come i bottoni delle barre degli editor: la
// pressione del puntatore non fa la sua azione di serie, che è spostare il
// fuoco. Il `click` arriva lo stesso, e il bottone resta raggiungibile col Tab:
// con la tastiera il fuoco ci arriva e ci resta, com'è giusto.
//
// Non va su un bottone che apre qualcosa (un menu, un pannello, una finestra):
// lì il fuoco va a ciò che si apre, e lo porta chi apre.
import type { Lifetime } from "../ui/lifetime";

export interface KeepFocusOptions {
  /// L'ascolto si scioglie con lei: per un elemento che sopravvive a chi lo
  /// monta. Senza, vive con l'elemento (bottoni creati e tolti da chi li
  /// possiede).
  readonly lifetime?: Lifetime;
  /// Per un bottone che a volte agisce sul posto e a volte apre: chiesto a
  /// ogni pressione. Senza, sempre.
  readonly when?: () => boolean;
}

/// Il clic col puntatore su `el` lascia il fuoco dov'era.
export function keepFocusOnPress(el: HTMLElement, options: KeepFocusOptions = {}): void {
  const { lifetime, when } = options;
  // Il fuoco di un clic lo dà il `mousedown` (anche quello che segue un tocco),
  // non il `pointerdown`: fermare questo non basterebbe.
  const hold = (event: MouseEvent): void => {
    if (when === undefined || when()) event.preventDefault();
  };
  if (lifetime) lifetime.listen(el, "mousedown", hold);
  else el.addEventListener("mousedown", hold);
}
