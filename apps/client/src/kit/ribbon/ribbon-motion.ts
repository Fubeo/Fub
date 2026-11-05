// Il movimento della barra multifunzione, per chi lo accende
// (`RibbonOptions.motion`: oggi soltanto i fogli).
//
// Come ogni movimento di Fub passa da `moto/`: lo stato cambia prima, e ciò
// che si vede muovere è la distanza dal vecchio; finita la corsa non resta
// niente, e lo stato finale con il movimento e senza è lo stesso al pixel.
// Ridotto e calmo li decide `moto/`: con «ridotto» ogni corsa salta, e il
// vassoio che torna appare soltanto in una dissolvenza.
//
// Ogni corsa vive nella vita della barra: smontata la barra, non resta niente.
import { DURATION, animate, enter, flip, liveState, prepareExit, stagger, type Ghost } from "../../moto";
import type { Lifetime } from "../../ui/lifetime";

/// Da quanti px nel verso della sezione entrano i foglietti di una sezione nuova.
export const TAB_TRAVEL = 8;
/// Da quanti px più su scende il contenuto di un foglietto che si apre.
export const FOLD_TRAVEL = 6;
/// Da che scala compare una sezione per la selezione (una tabella).
export const ENTER_SCALE = 0.96;
/// Di quanti px si alza il foglietto che si apre sul posto, prima di posarsi.
export const LIFT_TRAVEL = 2;

export interface RibbonMotionParts {
  /// La barra: l'immagine del vassoio che esce sta dentro di lei, sotto la
  /// formula e la griglia che le salgono sopra.
  readonly element: HTMLElement;
  /// Il vassoio delle sezioni.
  readonly panels: HTMLElement;
  /// Dove la barra è montata: ciò che gli sta dopo (gli avvisi, la formula,
  /// la griglia) è la tenda che sale e scende.
  readonly host: HTMLElement;
}

/// Una sezione del vassoio: il suo pannello e i suoi foglietti.
export interface RibbonSection {
  readonly panel: HTMLElement;
  readonly groups: readonly HTMLElement[];
}

export interface RibbonMotion {
  /// La sezione scelta è cambiata da `from` a `to` (già in vista): i
  /// foglietti di `to` entrano uno dopo l'altro, da destra se la sezione è
  /// dopo la vecchia (`direction` 1), da sinistra se è prima (-1). Quelli di
  /// `from` ancora in corsa escono come immagine da dove si vedevano.
  section(to: RibbonSection, from: RibbonSection | null, direction: 1 | -1): void;
  /// Il vassoio si mostra (`shown`) o si nasconde: `apply` cambia lo stato,
  /// e la tenda segue.
  tray(shown: boolean, apply: () => void): void;
  /// Un foglietto si apre sul posto (`opened`) o si richiude (`null`): `apply`
  /// cambia lo stato, e i foglietti `groups` scivolano al posto nuovo.
  fold(groups: readonly HTMLElement[], opened: HTMLElement | null, apply: () => void): void;
  /// Una sezione per la selezione è comparsa.
  appear(elements: readonly HTMLElement[]): void;
  /// `elements` stanno per andarsene (una sezione per la selezione che
  /// scompare): quelli ancora in corsa si misurano adesso, e la funzione resa,
  /// chiamata a stato cambiato, ne fa svanire l'immagine da dov'era.
  leave(elements: readonly HTMLElement[]): () => void;
  /// Le lettere di Alt sono comparse; `lifetime` è la loro.
  tips(badges: readonly HTMLElement[], lifetime: Lifetime): void;
}

/// La barra senza movimento: lo stato cambia, e basta.
export const STILL_RIBBON: RibbonMotion = {
  section: () => {},
  tray: (_shown, apply) => apply(),
  fold: (_groups, _opened, apply) => apply(),
  appear: () => {},
  leave: () => () => {},
  tips: () => {},
};

/// Chi ha un riquadro e sta nel flusso: un elemento solo per lettori di
/// schermo (`position: absolute`) non è parte della tenda.
function inFlow(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).position !== "absolute";
}

/// Chi è ancora in corsa: lui, o il contenuto di un foglietto che scende.
function moving(el: Element): boolean {
  return liveState(el) !== null || (el.firstElementChild !== null && liveState(el.firstElementChild) !== null);
}

export function ribbonMotion(parts: RibbonMotionParts, lifetime: Lifetime): RibbonMotion {
  const { element, panels, host } = parts;
  /// Ciò che sta sotto la barra, nello stesso contenitore.
  const below = (): HTMLElement[] => {
    const found: HTMLElement[] = [];
    for (let at = host.nextElementSibling; at; at = at.nextElementSibling) if (inFlow(at)) found.push(at);
    return found;
  };
  const shownNow = (): boolean => !panels.hidden && panels.getClientRects().length > 0;
  /// Un'immagine che se ne va col tempo di un'uscita, dentro la barra o in
  /// `layer`, dove prende gli stessi stili dell'originale.
  const vanish = (ghost: Ghost, layer: HTMLElement = element): void => {
    ghost.play({ layer, duration: DURATION.swap, easing: "ease-in", lifetime });
  };

  return {
    section(to, from, direction) {
      // Un gesto nuovo a metà corsa: ciò che della sezione vecchia entrava
      // ancora non sparisce, ne esce l'immagine da dove si vedeva. `kit/tabs`
      // l'ha già nascosta: per misurarla il vassoio torna com'era per un
      // istante, nello stesso giro, senza che niente si dipinga.
      const leaving = from ? from.groups.filter((group) => !group.hidden && moving(group)) : [];
      if (from && leaving.length > 0) {
        to.panel.hidden = true;
        from.panel.hidden = false;
        const images = leaving.map((group) => prepareExit(group));
        from.panel.hidden = true;
        to.panel.hidden = false;
        for (const image of images) vanish(image);
      }
      // `enter`: se un foglietto stava uscendo (avanti e indietro di fila),
      // riparte dalla posa della sua immagine.
      stagger(
        to.groups.filter((group) => !group.hidden),
        (group) => enter(group, { from: { x: TAB_TRAVEL * direction, opacity: 0 }, spring: "soft", lifetime }),
      );
    },

    tray(shown, apply) {
      const was = shownNow();
      if (was === shown) {
        apply();
        return;
      }
      if (!shown) {
        // Il vassoio non si muove: resta un'immagine che svanisce, e la
        // formula e la griglia gli salgono sopra come una tenda. Chi sale al
        // posto di ciò che esce finisce col tempo dell'uscita.
        const ghost = prepareExit(panels);
        flip(below(), apply, { edge: "top", scale: false, duration: DURATION.swap, easing: "ease-out", lifetime });
        vanish(ghost);
        return;
      }
      // La tenda ridiscende e lo scopre; se stava uscendo, `enter` riparte
      // dall'opacità che l'immagine aveva.
      flip(below(), apply, { edge: "top", scale: false, spring: "wide", lifetime });
      enter(panels, { from: { opacity: 0 }, spring: "wide", whenReduced: "fade", lifetime });
    },

    fold(groups, opened, apply) {
      // Ogni foglietto prende subito la forma nuova. Uno che era ancora in
      // corsa (un gesto nuovo a metà corsa) e cambia forma lascia l'immagine
      // di com'era, che svanisce da dove si vedeva: niente salta.
      let shaped: { el: HTMLElement; width: number; height: number; image: Ghost }[] = [];
      // Il foglietto che si apre si alza di un gradino (l'ombra cresce subito,
      // col CSS) e si posa con gli altri, nella stessa corsa.
      flip(
        groups,
        () => {
          shaped = groups
            .filter(moving)
            .map((el) => ({ el, width: el.offsetWidth, height: el.offsetHeight, image: prepareExit(el) }));
          apply();
        },
        {
          scale: false,
          spring: "snap",
          lifetime,
          ...(opened ? { lift: { element: opened, travel: LIFT_TRAVEL } } : {}),
        },
      );
      for (const { el, width, height, image } of shaped) {
        if (Math.abs(el.offsetWidth - width) >= 1 || Math.abs(el.offsetHeight - height) >= 1) vanish(image);
      }
      const body = opened?.firstElementChild;
      if (body) animate(body, { from: { y: -FOLD_TRAVEL, opacity: 0 }, spring: "soft", lifetime });
    },

    appear(elements) {
      for (const el of elements) animate(el, { from: { opacity: 0, scale: ENTER_SCALE }, spring: "soft", lifetime });
    },

    leave(elements) {
      // L'immagine resta dov'era l'originale (una scheda nella sua fila), che
      // non se ne va con lui.
      const images = elements.filter((el) => moving(el)).map((el) => ({ image: prepareExit(el), layer: el.parentElement ?? element }));
      return () => {
        for (const { image, layer } of images) vanish(image, layer);
      };
    },

    tips(badges, local) {
      for (const badge of badges) animate(badge, { from: { opacity: 0 }, duration: DURATION.state, easing: "ease-out", lifetime: local });
    },
  };
}
