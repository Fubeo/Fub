// `[[^^parole` (E13, T31) dal lato della shell: le note in cui l'indice trova
// le parole nello stesso blocco (la foglia `block:`), col loro testo, e l'id
// al blocco scelto col comando del blocco sincronizzato (`sync-block.ts`).
// Che cosa sia un blocco lo legge l'editor (`blocks/vault-blocks.ts`).
import { api } from "../host/ipc";
import { matchingDocuments, searchExpression } from "../host/query";
import { notify } from "../ui/notify";
import { vaultBlockQuery } from "../editors/text/profiles/markdown/completions";
import type { VaultBlockNote, VaultBlockPort } from "../editors/text/profiles/markdown/blocks/vault-blocks";
import { documentSessions } from "./document-session";
import { slashContextDoc } from "./slash";
import { giveBlockIdTold, syncBlockPort } from "./sync-block";

/// In quante note si cercano i blocchi: una finestra dell'indice, non il
/// vault intero.
const BLOCK_NOTES = 20;

/// Le note Markdown in cui l'indice trova `words` nello stesso blocco, nel
/// suo ordine, col testo della sessione aperta (che ha anche ciò che non è
/// salvato) o del file. Una nota che non si legge si salta.
async function blockNotes(words: string): Promise<VaultBlockNote[]> {
  const line = vaultBlockQuery(words);
  if (line === null) return [];
  const found = await matchingDocuments(searchExpression(line), { offset: 0, limit: BLOCK_NOTES }, "omit");
  const notes = await Promise.all(found.items
    .filter(({ doc }) => /\.(?:md|markdown)$/iu.test(doc))
    .map(async ({ doc }) => {
      try {
        return { doc, text: documentSessions.text(doc) ?? (await api.readDocument(doc)).text };
      } catch {
        return null;
      }
    }));
  return notes.filter((note): note is VaultBlockNote => note !== null);
}

/// La porta che `[[^^` riceve.
export const vaultBlockPort: VaultBlockPort = {
  notes: blockNotes,
  current: slashContextDoc,
  source: syncBlockPort.source,
  giveId: giveBlockIdTold,
  // Ogni avviso dice un link che non si è scritto.
  notify: (message, action) => notify(message, "guasto", action),
};
