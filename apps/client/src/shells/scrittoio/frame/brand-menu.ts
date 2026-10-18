// Il marchio apre il menu dell'applicazione.
//
// Il menu è quello di `ui/app-menu.ts`, costruito dal registro dei comandi:
// qui c'è solo come si presenta. A riposo non occupa la barra; aperto è una
// striscia che copre l'ala sinistra, e le sue tendine restano quelle di sempre.
// Lo stato vive in una classe sola, `open` su `#app-menu`, che anche
// `ui/titlebar.ts` sa togliere: chi la cambia, il marchio lo viene a sapere.
import type { Lifetime } from "../../../ui/lifetime";
import { byId, follow } from "./dom";

/** Lo spazio fra il marchio e la prima voce del menu. */
const BRAND_GAP = 4;

export function mountBrandMenu(lifetime: Lifetime): void {
  const brand = byId<HTMLButtonElement>("brand-menu");
  const menu = byId("app-menu");
  if (!brand || !menu) return;
  const isOpen = (): boolean => menu.classList.contains("open");
  const close = (): void => {
    if (isOpen()) menu.classList.remove("open");
  };
  // Dove il fuoco torna quando la striscia si richiude: dov'era prima che un
  // puntatore premesse il marchio. Da tastiera il fuoco era già sul marchio, e
  // lì torna.
  let returnTo: HTMLElement | null = null;
  /// La striscia chiusa nasconde le sue voci, e una voce nascosta non tiene il
  /// fuoco: finirebbe sul `body`, da dove la tastiera non arriva a niente. Se
  /// il comando scelto l'ha già portato altrove, lo si lascia dov'è.
  const settleFocus = (): void => {
    const active = document.activeElement;
    if (active && active !== document.body && !menu.contains(active)) return;
    const target = returnTo?.isConnected ? returnTo : brand;
    returnTo = null;
    target.focus();
  };
  let wasOpen = isOpen();
  const sync = (): void => {
    const open = isOpen();
    brand.setAttribute("aria-expanded", String(open));
    if (wasOpen && !open) settleFocus();
    wasOpen = open;
  };
  sync();
  follow(lifetime, menu, sync, { attributes: ["class"] });

  lifetime.listen(
    brand,
    "pointerdown",
    () => {
      if (isOpen()) return;
      const active = document.activeElement;
      returnTo = active instanceof HTMLElement && active !== document.body && !brand.contains(active) ? active : null;
    },
    { capture: true },
  );
  lifetime.listen(brand, "click", (event) => {
    event.stopPropagation();
    // Dove finisce il marchio lo sa il layout, non un numero scritto qui: la
    // striscia comincia subito dopo, a ogni passo dello spazio dell'interfaccia.
    byId("topbar")?.style.setProperty("--brand-end", `${brand.offsetLeft + brand.offsetWidth + BRAND_GAP}px`);
    const open = menu.classList.toggle("open");
    // L'osservatore lo verrebbe a sapere a fine giro: chi apre e richiude
    // nello stesso giro non deve trovarlo ancora convinto che fosse chiusa.
    if (open) wasOpen = true;
    if (open) menu.querySelector<HTMLElement>("button")?.focus();
  });
  lifetime.listen(
    menu,
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !isOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      brand.focus();
    },
    { capture: true },
  );
  // Un clic altrove richiude la striscia; uno dentro una sua tendina anche,
  // perché una voce scelta ha finito il lavoro del menu.
  lifetime.listen(document, "click", (event) => {
    if (!isOpen()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && (menu.contains(target) || brand.contains(target))) return;
    close();
  });
}
