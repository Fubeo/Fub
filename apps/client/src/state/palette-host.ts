// Ciò che la palette dei comandi chiede a chi la ospita, costruito una volta
// per tutte le shell: nessuna delle quattro voci disegna.
import { vaultEntries } from "../host/query";
import { applyIntent } from "../ui/intents";
import { notify } from "../ui/notify";
import { flushPendingSave } from "./document-session";

/// Ciò che la palette chiede alla shell.
export const paletteHost = {
  onEffect: applyIntent,
  notify,
  flushPendingSave,
  // Dal canale dati (§14.4), **con una finestra** (§2.9). Questi path
  // riempiono un `<datalist>`, cioè dei suggerimenti sopra un campo che resta
  // libero: chiedere l'anagrafe intera per proporne una manciata mandava
  // attraverso il ponte tutto il vault e creava un `<option>` per documento a
  // ogni apertura del pannello. Un suggerimento troncato non toglie niente a
  // chi scrive il path per intero.
  //
  // La forma giusta a regime è un'altra, ed è già scritto altrove: chiedere per
  // prefisso mentre si scrive, cioè `noteDalNome` (0082, 0083 — «le superfici
  // che propongono dei nomi fanno *la stessa* domanda»). Cablarla qui vuol dire
  // dare alla palette un campo che ascolta, che è la casella residua.
  listDocuments: () =>
    vaultEntries({ offset: 0, limit: 200 }, "document")
      .then((page) => page.items.map((e) => e.id))
      .catch(() => []),
};
