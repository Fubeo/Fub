// «Sposta in…» (E13, T32): il blocco va in un'altra nota col comando del
// nucleo `note.block.move`, che scrive le due note (e i link che seguono il
// blocco) tutte o nessuna, con un annulla solo. Qui la strada dal client: il
// testo non salvato si mette in salvo (il comando legge il disco, e controlla
// che fra quei byte ci sia ancora il blocco), le scritture si annunciano alle
// sessioni aperte, così la ricarica che ne viene non si dice, e l'esito si
// racconta con «Annulla».
import { COMMANDS } from "../host/contract";
import { errorText } from "../host/errors";
import { api } from "../host/ipc";
import { documentOutline, vaultEntries, WITHOUT_PAGE } from "../host/query";
import { t } from "../i18n/strings";
import { pageName } from "../rules/mirrored";
import { notify } from "../ui/notify";
import { expectDocumentWrite, flushPendingSave } from "./document-session";
import { openVaultRoot } from "./store";
import { refreshDocuments, undoLastOperation } from "./vault";
import type { MoveHeading, MoveNote, MoveRequest } from "../editors/text/profiles/markdown/blocks/move-to";

/// Le note in prosa del vault, dove un blocco di testo può andare: i
/// documenti che il Markdown serve, in ordine di percorso.
export async function moveNotes(): Promise<MoveNote[]> {
  const entries = await vaultEntries(WITHOUT_PAGE, "document");
  return entries.items
    .filter((entry) => /\.(md|markdown)$/i.test(entry.id))
    .map((entry) => ({ id: entry.id, title: pageName(entry.id) }));
}

/// I titoli della nota `doc`, come li legge l'indice.
export async function moveHeadings(doc: string): Promise<MoveHeading[]> {
  const outline = await documentOutline(doc);
  return outline.map((heading) => ({ slug: heading.slug, text: heading.text, level: heading.level, start: heading.span.start }));
}

/// Sposta il blocco: `null` se è andata, altrimenti la frase che dice perché
/// no (e le due note sono com'erano).
export async function moveBlock(request: MoveRequest): Promise<string | null> {
  const pending = await flushPendingSave();
  if (pending.length > 0) return t("document.unsaved_blocks", { doc: pending.join(", ") });
  const docs = [...new Set([request.doc, request.to])];
  const withdraw = docs.map((doc) => expectDocumentWrite(doc));
  try {
    const outcome = await api.invokeCommand(
      COMMANDS.moveBlock,
      {
        doc: request.doc,
        at: [...request.at],
        text: request.text,
        to: request.to,
        ...(request.heading === null ? {} : { heading: request.heading }),
        leave: request.leave,
      },
      undefined,
      openVaultRoot(),
    );
    refreshDocuments();
    if (outcome.notify) {
      notify(outcome.notify, "info", outcome.undo === null ? undefined : {
        label: t("app.undo"),
        run: () => {
          // Anche l'annulla riscrive le due note: le sessioni aperte
          // ricaricano senza dirlo.
          const back = docs.map((doc) => expectDocumentWrite(doc));
          void undoLastOperation().catch((error: unknown) => {
            for (const each of back) each();
            notify(t("trash.undo_failed", { reason: errorText(error) }), "guasto");
          });
        },
      });
    }
    return null;
  } catch (error) {
    for (const each of withdraw) each();
    return errorText(error);
  }
}
