// Il rilascio del tasto che ha aperto un menu non è un clic.
//
// Il `contextmenu` del tasto destro non arriva nello stesso momento ovunque.
// Su Windows arriva al rilascio, dopo `mouseup`: quando il menu compare il
// gesto è finito. Su Linux (WebKitGTK) arriva alla **pressione**: il menu
// compare col tasto ancora giù, e il rilascio viene dopo, sopra il menu
// appena aperto. WebKitGTK lo manda come un `mouseup` e poi un `click`, tutti e
// due col `button` del sinistro, e il `click` va all'antenato comune fra la
// riga premuta e il menu sotto il puntatore: per il menu era un clic fuori, e
// si chiudeva al rilascio senza fare niente (IMP-6201). Sopra una voce, o sopra
// un controllo che sta sotto il menu, lo stesso `click` lo avrebbe attivato.
//
// Qui il rilascio di quella pressione si riconosce dalla pressione, non dal
// `button` che il motore ci scrive: il menu aperto con un tasto ancora giù
// (`buttons` diverso da 0) inghiotte il `click` e l'`auxclick` che seguono il
// primo `mouseup`. Il menu resta aperto e una voce si sceglie con un clic.
//
// Come nei menu nativi di GTK, premere, scorrere fino a una voce e rilasciare
// la sceglie: se il puntatore si è mosso davvero dal punto della pressione e
// si alza sopra una voce (`pick`), la voce riceve il suo clic. Fermo, il
// rilascio non sceglie niente, nemmeno quando il menu, spinto in su dal bordo
// della finestra, si apre con una voce sotto il puntatore.
//
// La guardia vive finché quella pressione non finisce, non quanto il menu: un
// menu chiuso con Esc a tasto ancora giù non lascia passare il rilascio al
// controllo che c'è sotto. Una pressione nuova prima di un `mouseup` vuol dire
// che il rilascio è caduto fuori dalla finestra: la guardia si toglie e quella
// pressione resta un gesto vero.
import { openLifetime, type Lifetime } from "./lifetime";

/// Quanto deve muoversi il puntatore, a tasto giù, perché il rilascio sopra una
/// voce la scelga: sotto, è la mano che trema nel rilascio.
export const RELEASE_SLOP_PX = 4;

/// La guardia della pressione in corso: una sola, perché il tasto è uno.
let guard: Lifetime | null = null;

/// Se `at` è un `contextmenu` arrivato col tasto ancora premuto, inghiotte il
/// `click` del suo rilascio. `pick` trova, dal bersaglio del rilascio, la voce
/// da scegliere quando il puntatore ci è arrivato trascinando; `null` se lì
/// non c'è una voce.
export function swallowOpeningRelease(
  at: MouseEvent | HTMLElement | { readonly x: number; readonly y: number },
  pick?: (target: Element) => HTMLElement | null,
): void {
  // Un menu aperto in altro modo (un sottomenu del dito, un pulsante) non è
  // una pressione nuova: la guardia di quella in corso resta.
  if (!(at instanceof MouseEvent) || at.type !== "contextmenu" || at.buttons === 0) return;
  guard?.close();
  const lifetime = openLifetime();
  guard = lifetime;
  lifetime.add(() => {
    if (guard === lifetime) guard = null;
  });
  const from = { x: at.clientX, y: at.clientY };
  let released = false;
  const options = { capture: true } as const;
  lifetime.listen(window, "mouseup", (e) => {
    if (released) return;
    released = true;
    const moved = Math.hypot(e.clientX - from.x, e.clientY - from.y) > RELEASE_SLOP_PX;
    const chosen = moved && pick && e.target instanceof Element ? pick(e.target) : null;
    // Il `click` arriva subito dietro al `mouseup`, nello stesso giro: al
    // prossimo la pressione è finita, e la voce scelta trascinando riceve il
    // suo clic, uno solo.
    const settle = setTimeout(() => {
      lifetime.close();
      if (chosen?.isConnected) chosen.click();
    }, 0);
    lifetime.add(() => clearTimeout(settle));
  }, options);
  const swallow = (e: MouseEvent): void => {
    if (!released) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  lifetime.listen(window, "click", swallow, options);
  lifetime.listen(window, "auxclick", swallow, options);
  // Una pressione nuova senza rilascio: il rilascio è caduto fuori.
  lifetime.listen(window, "mousedown", () => {
    if (!released) lifetime.close();
  }, options);
}
