// «Usa la versione su disco» mette il testo dell'utente nella Cronologia
// prima di scartarlo.
//
// La conservazione è il comando `version.keep` della Cronologia, chiesto con
// la porta generica dei comandi: c'è soltanto quando la Cronologia è montata.
// Il controller lo esegue (`resolveDiscardingMine`, e per la finestra
// staccata il custode del ponte, `setDocumentWindowKeeper`); le conferme (il
// banner del riquadro, il foglio dello stato di salvataggio) e la descrizione
// del comando nella palette scelgono qui la frase, così dicono com'è davvero
// se il testo resterà o andrà perso.
import type { Key } from "../i18n/strings";
import { hasKernelCommand } from "../ui/commands";
import { documentSessions } from "./document-session";

/// Il comando della Cronologia che conserva un testo con una nota.
export const VERSION_KEEP = "version.keep";

/// Se «Usa la versione su disco» su `doc` conserva il testo prima di
/// scartarlo: serve il comando (la Cronologia accesa) e un documento il cui
/// testo in Fub è il file (non il giornale della griglia).
export function keepsDiscardedText(doc: string): boolean {
  return hasKernelCommand(VERSION_KEEP) && documentSessions.keepsDiscardedText(doc);
}

/// La frase della conferma di «Usa la versione su disco» su `doc`, e della
/// sua descrizione nella palette: senza un documento (la palette senza una
/// nota attiva) conta soltanto se il comando c'è.
export function discardDescription(doc: string | null): Key {
  const keeps = doc === null ? hasKernelCommand(VERSION_KEEP) : keepsDiscardedText(doc);
  return keeps ? "commands.doc.conflict.theirs.desc" : "commands.doc.conflict.theirs.desc_lost";
}

/// Il testo della conferma di «Usa la versione su disco» nella barra del
/// conflitto: dice in una frase che cosa succede al testo non salvato, se
/// resta nella Cronologia o se si perde.
export function discardBody(doc: string): Key {
  return keepsDiscardedText(doc) ? "document.conflict.theirs.body_kept" : "document.conflict.theirs.body";
}
