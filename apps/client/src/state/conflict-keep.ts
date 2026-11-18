// «Usa la versione su disco» mette il testo dell'utente nella Cronologia
// prima di scartarlo.
//
// La conservazione è il comando `version.keep` della Cronologia, chiesto con
// la porta generica dei comandi: c'è soltanto quando la Cronologia è montata.
// Il controller lo esegue (`resolveDiscardingMine`); le due conferme (il
// banner del riquadro e il foglio dello stato di salvataggio) scelgono qui la
// frase, così dicono com'è davvero se il testo resterà o andrà perso.
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

/// La frase della conferma di «Usa la versione su disco» su `doc`.
export function discardDescription(doc: string): Key {
  return keepsDiscardedText(doc) ? "commands.doc.conflict.theirs.desc" : "commands.doc.conflict.theirs.desc_lost";
}
