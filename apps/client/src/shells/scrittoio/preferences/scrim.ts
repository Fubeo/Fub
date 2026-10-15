// Il velo dietro la finestra delle preferenze.
//
// La vista apre e chiude il suo pannello (`hidden`, `data-shell-motion`); un
// fondo suo non ce l'ha, e sotto la finestra aperta la shell restava premibile.
// Il velo è un nodo fratello che segue il pannello: c'è quando c'è lui, entra
// ed esce con lui, e ferma i clic.
import "./preferences.css";
import type { Lifetime } from "../../../ui/lifetime";
import { byId, follow } from "../frame/dom";
import { setAttr } from "./rows";

export function mountScrim(lifetime: Lifetime, panel: HTMLElement): void {
  const scrim = document.createElement("div");
  scrim.className = "settings-scrim";
  panel.before(scrim);
  lifetime.add(() => scrim.remove());

  const sync = (): void => {
    if (scrim.hidden !== panel.hidden) scrim.hidden = panel.hidden;
    // Lo stesso attributo del pannello: la pelle anima i due con una regola
    // sola, e l'uscita ferma il puntatore su tutti e due.
    setAttr(scrim, "data-shell-motion", panel.getAttribute("data-shell-motion"));
  };
  follow(lifetime, panel, sync, { attributes: ["hidden", "data-shell-motion"] });
  sync();

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
