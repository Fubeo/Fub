// I tasti dell'utente seguiti dal Completo aperto (piano K6, T9c): legge
// `draw.keys` all'apertura e a ogni `setting_changed` della chiave, così un
// tasto cambiato in Impostazioni › Scorciatoie vale subito nei disegni aperti,
// senza riaprirli. Una lettura superata da una più recente non arriva; una che
// non riesce lascia le modifiche di prima.

import { settings } from "../../../host/query";
import { onEvent } from "../../../state/kernel";
import type { Lifetime } from "../../../ui/lifetime";
import { DRAW_KEYS_KEY, leggiTasti, modificheDi } from "./tasti-utente";
import type { ModificheTasti } from "./tasti";

/// Il bundle delle impostazioni dei disegni.
const DRAW_BUNDLE = "fub.draw";

/// Segue `draw.keys` finché `vita` vive; `cambiate` è chiamata dopo ogni
/// lettura nuova. Torna chi dà le modifiche adesso (`{}` finché la prima
/// lettura non arriva).
export function seguiTastiUtente(vita: Lifetime, cambiate: () => void): () => ModificheTasti {
  let attuali: ModificheTasti = {};
  let giro = 0;
  const leggi = (): void => {
    const questo = ++giro;
    void settings(DRAW_BUNDLE).then(
      (voci) => {
        if (vita.closed || questo !== giro) return;
        const valore = voci.find((voce) => voce.spec.key === DRAW_KEYS_KEY)?.value;
        attuali = modificheDi(leggiTasti(valore ?? ""));
        cambiate();
      },
      () => undefined,
    );
  };
  const smetti = onEvent("setting_changed", (event) => {
    if (event.key === DRAW_KEYS_KEY) leggi();
  });
  if (typeof smetti === "function") vita.add(smetti);
  leggi();
  return () => attuali;
}
