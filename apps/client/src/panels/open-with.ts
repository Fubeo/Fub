// «Apri con un'altra app» nel menu dell'albero (N7, D-6). Senza app Craft
// installate è la voce di sempre, che passa il file all'app predefinita del
// sistema. Con almeno una diventa un sottomenu a cascata: per prima l'app del
// sistema, poi le app Craft che aprono quel file, chieste all'host quando il
// sottomenu si apre (`ui/menu.ts` mostra l'attesa, e col dito lo apre al
// posto del menu, con la voce per tornare).

import { t } from "../i18n/strings";
import type { MenuItem } from "../ui/menu";
import { openWithChoices, shellOpenWith, type OpenWithChoice, type OpenWithHost } from "../state/external-editors";

export interface OpenWithDeps {
  /// L'app predefinita del sistema: la voce di sempre, e la prima del
  /// sottomenu.
  readonly system: () => void;
  /// Le domande all'host; senza, quelle della shell principale.
  readonly host?: OpenWithHost;
}

/// Una voce del sottomenu nella forma del menu: la spenta dice perché.
export function choiceItem(choice: OpenWithChoice): MenuItem {
  return {
    label: choice.label,
    ...(choice.note === undefined ? {} : { description: choice.note }),
    ...(choice.disabled ? { disabled: true } : {}),
    run: choice.run,
  };
}

/// La voce «Apri con un'altra app» per `doc`.
export function openWithEntry(doc: string, deps: OpenWithDeps): MenuItem {
  const host = deps.host ?? shellOpenWith;
  const label = t("explorer.open_system");
  if (!host.installed()) return { label, run: deps.system };
  return {
    label,
    submenu: true,
    items: async () => (await openWithChoices(doc, deps.system, host)).map(choiceItem),
  };
}
