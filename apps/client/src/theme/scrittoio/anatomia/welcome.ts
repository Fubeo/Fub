/** L'anatomia del pezzo `skin/welcome.css`. Il benvenuto. */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const WELCOME: PartAnatomy = {
  part: "welcome",
  layer: "cornice",
  components: [
    // La colonna al centro della scrivania e ciò che dice mentre si apre.
    { name: "welcome-surface", states: REST, hooks: ["onboarding", "onboarding-status", "onboarding-error"] },
    // Le azioni: fogli sulla scrivania, gradini della carta dentro una scheda.
    { name: "welcome-actions", states: INTERACTIVE, hooks: ["onboarding-actions", "primary"] },
    // Un recente: il foglio intero è il bersaglio del nome. `link-button` e
    // `muted` sono hook condivisi: qui si vestono solo dentro la riga.
    { name: "recent-vaults", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["onboarding-recent", "onboarding-recent-item", "onboarding-forget", "link-button", "muted"] },
    // Il profilo di un vault nuovo: la colonna, la riga d'esito e il
    // promemoria; la riga dei profili è delle impostazioni (`components-*`).
    { name: "welcome-profile", states: REST, hooks: ["onboarding-profile", "onboarding-profile-status", "onboarding-profile-note", "components-profiles"] },
    { name: "welcome-extras", states: [S("rest"), S("hover"), S("focused")], hooks: ["onboarding-extra", "onboarding-trouble"] },
  ],
};
