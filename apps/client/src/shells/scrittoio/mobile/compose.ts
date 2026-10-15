// La composizione dello Scrittoio su un telefono.
//
// Fa ciò che `../bootstrap.ts` fa sul desktop, senza le sue dichiarazioni: la
// shell e la serie le ha già dichiarate l'ingresso (`entrypoints/
// mobile.ts`), che per questo importa il modulo in modo dinamico.
// Sopra la cornice comune monta ciò che è del telefono.
import { startup as shellStartup } from "../../../desktop-shell";
import { openLifetime, type Teardown } from "../../../ui/lifetime";
import { mountShellCommands } from "../commands";
import { mountConfirm } from "../confirm";
import { mountFrame } from "../frame";
import { mountLauncher } from "../launcher";
import { mountMotion } from "../motion";
import { mountSheets } from "../sheets";
import { mountMobileFrame } from "./frame";

export async function composeScrittoioMobile(): Promise<Teardown> {
  const teardownShell = await shellStartup;
  const lifetime = openLifetime();
  mountMotion(lifetime);
  mountConfirm(lifetime);
  // Prima i comandi, poi chi li preme: la cornice legge dal registro nomi e accordi.
  mountShellCommands(lifetime);
  mountFrame(lifetime);
  mountLauncher(lifetime);
  mountSheets(lifetime);
  mountMobileFrame(lifetime);
  return () => {
    lifetime.close();
    teardownShell();
  };
}
