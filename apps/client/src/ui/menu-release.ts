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
// rilascio cade sul bordo del menu, che nasce sotto il puntatore, e non
// sceglie niente.
//
// La guardia vive finché quella pressione non finisce, non quanto il menu: un
// menu chiuso con Esc a tasto ancora giù non lascia passare il rilascio al
// controllo che c'è sotto. Una pressione nuova prima di un `mouseup` vuol dire
// che il rilascio è caduto fuori dalla finestra: la guardia si toglie e quella
// pressione resta un gesto vero.

/// Quanto deve muoversi il puntatore, a tasto giù, perché il rilascio sopra una
/// voce la scelga: sotto, è la mano che trema nel rilascio.
export const RELEASE_SLOP_PX = 4;

/// La guardia della pressione in corso: una sola, perché il tasto è uno.
let dispose: (() => void) | null = null;

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
  dispose?.();
  const from = { x: at.clientX, y: at.clientY };
  let released = false;
  let chosen: HTMLElement | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const options = { capture: true } as const;
  const up = (e: MouseEvent): void => {
    if (released) return;
    released = true;
    const moved = Math.hypot(e.clientX - from.x, e.clientY - from.y) > RELEASE_SLOP_PX;
    if (moved && pick && e.target instanceof Element) chosen = pick(e.target);
    // Il `click` arriva subito dietro al `mouseup`, nello stesso giro: al
    // prossimo la pressione è finita, e la voce scelta trascinando riceve il
    // suo clic, uno solo.
    settle = setTimeout(() => {
      const target = chosen;
      stop();
      if (target?.isConnected) target.click();
    }, 0);
  };
  const swallow = (e: MouseEvent): void => {
    if (!released) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // Una pressione nuova senza rilascio: il rilascio è caduto fuori.
  const press = (): void => {
    if (!released) stop();
  };
  const stop = (): void => {
    if (dispose !== stop) return;
    dispose = null;
    if (settle !== undefined) clearTimeout(settle);
    window.removeEventListener("mouseup", up, options);
    window.removeEventListener("click", swallow, options);
    window.removeEventListener("auxclick", swallow, options);
    window.removeEventListener("mousedown", press, options);
  };
  window.addEventListener("mouseup", up, options);
  window.addEventListener("click", swallow, options);
  window.addEventListener("auxclick", swallow, options);
  window.addEventListener("mousedown", press, options);
  dispose = stop;
}
