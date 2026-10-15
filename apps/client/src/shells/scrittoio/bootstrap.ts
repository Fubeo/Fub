// La composizione della shell Scrittoio.
//
// Sotto c'è la shell comune (`desktop-shell.ts`): sessioni, riquadri, comandi,
// pannelli. Qui sopra sta ciò che è di Scrittoio: la struttura della finestra,
// la serie del tema e le superfici della cornice. La shell comune non sa quale
// cornice ha attorno; trova per id i manici che `index.html` le lascia.
import "../../theme/scrittoio/structure.css";
import "./declare";
import { startup as shellStartup } from "../../desktop-shell";
import { openLifetime, type Teardown } from "../../ui/lifetime";
import { mountShellCommands } from "./commands";
import { mountConfirm } from "./confirm";
import { mountFrame } from "./frame";
import { mountLauncher } from "./launcher";
import { mountMotion } from "./motion";
import { mountPreferences } from "./preferences";
import { mountSheets } from "./sheets";
import { mountStageMotion } from "./stage-motion";
import { mountViewsMotion } from "./views-motion";
import { mountThemeSettingsSource } from "./theme-settings-source";

export const startup: Promise<Teardown> = shellStartup.then((teardownShell) => {
  const lifetime = openLifetime();
  mountMotion(lifetime);
  mountViewsMotion(lifetime);
  mountConfirm(lifetime);
  // Prima i comandi, poi chi li preme: la cornice legge dal registro nomi e accordi.
  mountShellCommands(lifetime);
  mountFrame(lifetime);
  mountLauncher(lifetime);
  mountSheets(lifetime);
  // Dopo la cornice e i fogli: misura ciò che loro hanno appena disegnato.
  mountStageMotion(lifetime);
  // Prima la sorgente, poi la schermata che le chiede le voci.
  mountThemeSettingsSource(lifetime);
  mountPreferences(lifetime);
  return () => {
    lifetime.close();
    teardownShell();
  };
});
