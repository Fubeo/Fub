// Ciò che la palette dei comandi chiede a chi la ospita, costruito una volta
// per tutte le shell: nessuna delle quattro voci disegna.
import { notesByName, vaultEntries } from "../host/query";
import { applyIntent } from "../ui/intents";
import { notify } from "../ui/notify";
import { flushPendingSave } from "./document-session";
import { focusedSurfaceCommands } from "./document-controller";

/// Quanti documenti la palette suggerisce a campo vuoto.
export const DOCUMENT_WINDOW = 200;

/// Ciò che la palette chiede alla shell.
export const paletteHost = {
  onEffect: applyIntent,
  notify,
  flushPendingSave,
  // I comandi della superficie col fuoco: quelli del foglio, con «Foglio».
  editorCommands: focusedSurfaceCommands,
  // Dal canale dati (§14.4), **con una finestra** (§2.9). Questi path
  // riempiono un `<datalist>`, cioè dei suggerimenti sopra un campo che resta
  // libero: chiedere l'anagrafe intera per proporne una manciata mandava
  // attraverso il ponte tutto il vault e creava un `<option>` per documento a
  // ogni apertura del pannello. Un suggerimento troncato non toglie niente a
  // chi scrive il path per intero.
  //
  // Mentre si scrive la domanda è per nome, `notesByName` (0082, 0083 — «le
  // superfici che propongono dei nomi fanno *la stessa* domanda»): trova anche
  // la nota che la finestra taglia, e ne porta indietro una ventina (#237 R06).
  listDocuments: (text = "") =>
    (text.trim()
      ? notesByName(text)
      : vaultEntries({ offset: 0, limit: DOCUMENT_WINDOW }, "document").then((page) => page.items.map((e) => e.id)))
      .catch(() => []),
};
