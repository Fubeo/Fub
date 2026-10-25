// Il velo dietro la finestra delle preferenze.
//
// La vista apre e chiude il suo pannello (`hidden`); un fondo suo non ce l'ha,
// e sotto la finestra aperta la shell restava premibile. Il velo è un nodo
// fratello che segue il pannello: c'è quando c'è lui, entra ed esce con lui,
// e ferma i clic.
import "./preferences.css";
import { DURATION, animate, exitGhost } from "../../../moto";
import type { Lifetime } from "../../../ui/lifetime";
import { byId, follow } from "../frame/dom";

export function mountScrim(lifetime: Lifetime, panel: HTMLElement): void {
  const scrim = document.createElement("div");
  scrim.className = "settings-scrim";
  panel.before(scrim);
  lifetime.add(() => scrim.remove());

  // Il velo sfuma col pannello; della sua uscita resta un'immagine, e il velo
  // vero se ne va subito, così non ferma più i clic.
  const sync = (first = false): void => {
    if (scrim.hidden === panel.hidden) return;
    if (panel.hidden && !first) exitGhost(scrim, { duration: DURATION.swap, easing: "ease-in", lifetime });
    scrim.hidden = panel.hidden;
    if (!scrim.hidden && !first) animate(scrim, { from: { opacity: 0 }, duration: DURATION.short, whenReduced: "fade", lifetime });
  };
  follow(lifetime, panel, () => sync(), { attributes: ["hidden"] });
  sync(true);

  // Chiude un gesto cominciato e finito sul velo: chi seleziona un testo nella
  // finestra e rilascia fuori non la perde.
  let pressed = false;
  lifetime.listen(scrim, "pointerdown", (event) => {
    pressed = event.button === 0 && event.target === scrim;
  });
  lifetime.listen(scrim, "click", (event) => {
    const mine = pressed && event.target === scrim;
    pressed = false;
    if (mine) byId("settings-close")?.click();
  });
}
