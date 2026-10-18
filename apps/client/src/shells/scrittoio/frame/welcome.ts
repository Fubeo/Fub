// Il benvenuto: la scrivania prima che ci sia un vault.
//
// Che non c'è un vault lo decide la shell comune, che mostra `#onboarding`.
// Qui si legge quel fatto e lo si scrive sulla finestra (`data-welcome`): la
// struttura ritira ciò che senza vault non ha niente da mostrare — i due
// cassetti, le icone del binario che scelgono un pannello, indietro e avanti,
// il bottone dell'ispettore. `hidden` non si tocca: la preferenza resta quella
// che era, e si ritrova com'era appena un vault si apre.
//
// I vault recenti sono fogli. La prima volta che si vedono escono dal mazzo e
// si aprono a ventaglio fino al loro posto: una volta sola, e solo nel livello
// pieno del moto, perché è una scena e non una risposta a un gesto.
import { animate, motionLevel, stagger } from "../../../moto";
import type { Lifetime } from "../../../ui/lifetime";
import { byId, follow } from "./dom";

/// Di quanto un foglio del mazzo è ruotato rispetto al vicino, e fin dove.
const TILT_DEG = 5;
const MAX_TILT_DEG = 14;
/// Il mazzo sta un poco più in basso del posto dei fogli e un poco più piccolo.
const PILE_DROP = 14;
const PILE_SCALE = 0.94;
/// Il ritardo fra un foglio e il successivo (ms).
const FAN_EACH = 30;

export function mountWelcome(lifetime: Lifetime): void {
  const app = byId("app");
  const onboarding = byId("onboarding");
  if (!app || !onboarding) return;
  const recents = byId("onboarding-recent");

  let fanned = false;
  const fan = (): void => {
    if (fanned || !recents || onboarding.hidden) return;
    const sheets = [...recents.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
    if (sheets.length === 0) return;
    fanned = true;
    if (motionLevel() !== "full") return;
    // Prima tutte le misure, poi le corse: una corsa in attesa tiene già il
    // foglio nella posa di partenza, e misurarlo dopo darebbe il mazzo.
    const pile = recents.getBoundingClientRect();
    const centre = { x: pile.left + pile.width / 2, y: pile.top + pile.height / 2 };
    const middle = (sheets.length - 1) / 2;
    const poses = sheets.map((sheet, index) => {
      const box = sheet.getBoundingClientRect();
      const tilt = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, (index - middle) * TILT_DEG));
      return {
        x: centre.x - (box.left + box.width / 2),
        y: centre.y - (box.top + box.height / 2) + PILE_DROP,
        rotate: tilt,
        scale: PILE_SCALE,
      };
    });
    stagger(
      sheets,
      (sheet, index) => animate(sheet, { from: poses[index], spring: "wide", whenReduced: "none", lifetime }),
      { each: FAN_EACH },
    );
  };

  const sync = (): void => {
    const welcome = !onboarding.hidden;
    // Si scrive solo ciò che cambia: chi osserva la finestra non va svegliato
    // per un valore che ha già.
    if (welcome) {
      if (app.dataset.welcome === undefined) app.dataset.welcome = "";
    } else if (app.dataset.welcome !== undefined) delete app.dataset.welcome;
    fan();
  };
  sync();
  follow(lifetime, onboarding, sync, { attributes: ["hidden"] });
  // L'elenco lo riscrive la shell comune a ogni risposta dell'host: se arriva
  // dopo che il benvenuto è già in vista, il ventaglio parte da qui.
  if (recents) follow(lifetime, recents, fan);
}
