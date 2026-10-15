// «Indietro» chiude ciò che sta sopra il foglio.
//
// Su un telefono il gesto o il tasto «indietro» del sistema è un passo nella
// cronologia della pagina. Finché un pannello è aperto ce n'è uno in più, messo
// qui: tornare indietro lo consuma e chiude il pannello, invece di lasciare
// l'applicazione. Se il pannello si chiude in un altro modo, il passo si ritira.
import type { Lifetime } from "../../../ui/lifetime";

export interface BackClose {
  /** Dice se adesso c'è qualcosa che «indietro» deve chiudere. */
  set(open: boolean): void;
}

export function mountBackClose(lifetime: Lifetime, close: () => void): BackClose {
  const view = window;
  /// Il passo in più è nella cronologia.
  let armed = false;
  /// I ritorni chiesti da qui: quando arrivano non chiudono niente.
  let retiring = 0;
  const retire = (): void => {
    armed = false;
    retiring += 1;
    view.history.back();
  };
  lifetime.listen(view, "popstate", () => {
    if (retiring > 0) {
      retiring -= 1;
      return;
    }
    if (!armed) return;
    armed = false;
    close();
  });
  // Smontata la shell, il passo non resta nella cronologia.
  lifetime.add(() => {
    if (armed) retire();
  });
  return {
    set(open) {
      if (open === armed) return;
      if (open) {
        view.history.pushState({ fubPanel: true }, "");
        armed = true;
      } else {
        retire();
      }
    },
  };
}
