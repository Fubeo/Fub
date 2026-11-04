// «Apri con un'altra app» nel menu dell'albero (N7, D-6). Senza app Craft
// installate è la voce di sempre, che passa il file all'app predefinita del
// sistema. Con almeno una diventa un sottomenu a cascata: per prima l'app del
// sistema, poi le app Craft che aprono quel file, chieste all'host quando il
// sottomenu si apre (`ui/menu.ts` mostra l'attesa, e col dito lo apre al
// posto del menu, con la voce per tornare).
//
// Scegliere un'app Craft per un documento che ha una scheda aperta è un
// prestito (T17, `state/lend.ts`): Fub salva prima le modifiche in coda, e se
// il salvataggio non riesce non apre l'app; se l'app lo apre, le schede del
// documento restano in sola lettura finché non lo si riprende. L'app del
// sistema non presta niente.

import { t } from "../i18n/strings";
import type { MenuItem } from "../ui/menu";
import { openWithChoices, shellOpenWith, type OpenWithChoice, type OpenWithHost } from "../state/external-editors";
import { lendGate, reserveLend, type LendGate } from "../state/lend";

export interface OpenWithDeps {
  /// L'app predefinita del sistema: la voce di sempre, e la prima del
  /// sottomenu.
  readonly system: () => void;
  /// Le domande all'host; senza, quelle della shell principale.
  readonly host?: OpenWithHost;
  /// Chi tiene le schede, per il prestito; senza, la porta che il controller
  /// dei documenti ha registrato (`provideLendGate`).
  readonly lending?: () => LendGate | null;
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

/// Il nome di un file per le frasi: l'ultimo pezzo del percorso.
function fileName(doc: string): string {
  return doc.slice(doc.lastIndexOf("/") + 1);
}

/// L'host di «Apri con» col prestito attorno all'apertura. I nomi delle app
/// si ricordano dall'elenco che il sottomenu ha appena chiesto: sono quelli
/// che la riga «Aperto in {app}» mostra.
///
/// Un rifiuto qui (il salvataggio fallito, l'app che non parte) arriva a
/// `openWithChoices`, che ne mostra la frase: un avviso solo.
export function lendingHost(host: OpenWithHost, lending: () => LendGate | null): OpenWithHost {
  const names = new Map<string, string>();
  return {
    installed: () => host.installed(),
    editors: async (doc, vault) => {
      const editors = await host.editors(doc, vault);
      for (const editor of editors) names.set(editor.id, editor.name);
      return editors;
    },
    open: async (doc, editor, vault) => {
      const gate = lending();
      if (!gate?.lendable(doc)) return host.open(doc, editor, vault);
      const app = names.get(editor) ?? editor;
      // La prenotazione segue la rinomina durante le due attese, e muore con
      // la chiusura del vault: una risposta vecchia non presta un documento
      // che nel frattempo non è più quello.
      const reservation = reserveLend(doc, (current) => gate.lendable(current));
      try {
        const unsaved = await gate.flush();
        if (unsaved.includes(reservation.doc)) {
          throw new Error(t("lend.save_failed", { doc: fileName(reservation.doc), app }));
        }
        const opened = await host.open(reservation.doc, editor, vault);
        reservation.commit(app);
        return opened;
      } finally {
        reservation.cancel();
      }
    },
  };
}

/// La voce «Apri con un'altra app» per `doc`.
export function openWithEntry(doc: string, deps: OpenWithDeps): MenuItem {
  const host = deps.host ?? shellOpenWith;
  const label = t("explorer.open_system");
  if (!host.installed()) return { label, run: deps.system };
  const lending = lendingHost(host, deps.lending ?? lendGate);
  return {
    label,
    submenu: true,
    items: async () => (await openWithChoices(doc, deps.system, lending)).map(choiceItem),
  };
}
