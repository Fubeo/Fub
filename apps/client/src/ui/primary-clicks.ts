// Solo il tasto sinistro fa clic.
//
// WebKitGTK manda un `click` anche dopo il tasto centrale, e col `button` del
// sinistro: chi ascolta `click` non sa distinguerlo da un clic vero, e il
// centrale apriva le cartelle dell'albero (IMP-002) e attivava le schede
// (IMP-012). Chromium non lo manda, e manda invece `auxclick`. Il tasto di un
// clic si sa quindi dalla pressione che lo ha cominciato: un clic cominciato da
// un altro tasto non arriva a chi ascolta sotto `el`. Il centrale, se chi monta
// lo vuole, arriva una volta sola per pressione a `onMiddle`, in tutti e due i
// motori.

export interface PrimaryClickOptions {
  /// Il tasto centrale premuto e lasciato su `el`: una chiamata per pressione,
  /// col bersaglio della pressione.
  onMiddle?: (target: Element) => void;
}

/// Lascia arrivare sotto `el` solo i clic del tasto sinistro e quelli senza
/// tasti (Invio, `.click()`). Il centrale non scorre la pagina né incolla la
/// selezione di X11. Torna il disposer.
export function primaryClicksOnly(el: HTMLElement, options: PrimaryClickOptions = {}): () => void {
  let pressed = 0;
  let middle: Element | null = null;
  const down = (event: MouseEvent): void => {
    pressed = event.button;
    middle = event.button === 1 && event.target instanceof Element ? event.target : null;
    if (event.button === 1) event.preventDefault();
  };
  const swallow = (event: MouseEvent): void => {
    // `detail` 0: un clic dato da Invio o da `.click()`, che non ha tasti.
    if (event.type === "click" && (event.detail === 0 || (pressed === 0 && event.button === 0))) return;
    event.preventDefault();
    event.stopPropagation();
    const target = middle;
    middle = null;
    if (target && options.onMiddle) options.onMiddle(target);
  };
  el.addEventListener("mousedown", down, { capture: true });
  el.addEventListener("click", swallow, { capture: true });
  el.addEventListener("auxclick", swallow, { capture: true });
  return () => {
    el.removeEventListener("mousedown", down, { capture: true });
    el.removeEventListener("click", swallow, { capture: true });
    el.removeEventListener("auxclick", swallow, { capture: true });
  };
}
