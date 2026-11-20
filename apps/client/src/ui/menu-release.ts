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
// `button` che il motore ci scrive: dopo un `contextmenu` arrivato con un tasto
// ancora giù (`buttons` diverso da 0) il `click` e l'`auxclick` che seguono il
// primo `mouseup` non arrivano a nessuno. Il menu resta aperto e una voce si
// sceglie con un clic. La guardia è una, sulla finestra, e vale per ogni menu:
// quelli di `showContextMenu`, aperti nel punto del gesto o in un punto
// calcolato, anche dopo un'attesa, e quelli fatti a parte (la tendina degli
// strumenti), senza che ognuno debba ricordarsene. Dove nessun menu si apre, il
// rilascio del tasto destro non diventa il clic di un pulsante.
//
// Come nei menu nativi di GTK, premere, scorrere fino a una voce e rilasciare
// la sceglie: se il puntatore si è mosso davvero dal punto della pressione e
// si alza sopra una voce di un menu (`[role^="menuitem"]`), la voce riceve il
// suo clic. Fermo, il rilascio non sceglie niente, nemmeno quando il menu,
// spinto in su dal bordo della finestra, si apre con una voce sotto il
// puntatore.
//
// La guardia vive finché quella pressione non finisce, non quanto il menu: un
// menu chiuso con Esc a tasto ancora giù non lascia passare il rilascio al
// controllo che c'è sotto. Una pressione nuova prima di un `mouseup` vuol dire
// che il rilascio è caduto fuori dalla finestra (o in un menu del sistema):
// la guardia si toglie e quella pressione resta un gesto vero.
import { openLifetime, type Lifetime } from "./lifetime";

/// Quanto deve muoversi il puntatore, a tasto giù, perché il rilascio sopra una
/// voce la scelga: sotto, è la mano che trema nel rilascio.
export const RELEASE_SLOP_PX = 4;

/// Le voci che il rilascio trascinato può scegliere.
const MENU_ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

function itemUnder(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest<HTMLElement>(MENU_ITEM);
  if (item === null || item.getAttribute("aria-disabled") === "true") return null;
  if (item instanceof HTMLButtonElement && item.disabled) return null;
  return item;
}

/// Monta la guardia sulla finestra: dopo ogni `contextmenu` a tasto giù, il
/// clic del rilascio non arriva a nessuno.
export function mountMenuRelease(lifetime: Lifetime): void {
  let press: Lifetime | null = null;
  const end = (): void => {
    press?.close();
    press = null;
  };
  lifetime.add(end);
  lifetime.listen(window, "contextmenu", (at) => {
    // Il tasto Menu, Maiusc+F10, la pressione lunga e Windows (che lo manda
    // dopo il rilascio) arrivano senza tasti giù: non c'è un rilascio da
    // aspettare.
    if (at.buttons === 0) return;
    end();
    const own = openLifetime();
    press = own;
    const from = { x: at.clientX, y: at.clientY };
    let released = false;
    const options = { capture: true } as const;
    own.listen(window, "mouseup", (e) => {
      if (released) return;
      released = true;
      const moved = Math.hypot(e.clientX - from.x, e.clientY - from.y) > RELEASE_SLOP_PX;
      const chosen = moved ? itemUnder(e.target) : null;
      // Il `click` arriva subito dietro al `mouseup`, nello stesso giro: al
      // prossimo la pressione è finita, e la voce scelta trascinando riceve il
      // suo clic, uno solo.
      const settle = setTimeout(() => {
        if (press === own) end();
        if (chosen?.isConnected) chosen.click();
      }, 0);
      own.add(() => clearTimeout(settle));
    }, options);
    const swallow = (e: MouseEvent): void => {
      if (!released) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    own.listen(window, "click", swallow, options);
    own.listen(window, "auxclick", swallow, options);
    // Una pressione nuova senza rilascio: il rilascio è caduto fuori.
    own.listen(window, "mousedown", () => {
      if (!released && press === own) end();
    }, options);
  }, { capture: true });
}
