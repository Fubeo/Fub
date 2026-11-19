// «Trasforma in foglio» (E23, T52): la tabella di una nota diventa un foglio
// accanto a lei col comando del nucleo `note.table.sheet`, che scrive il
// foglio e la nota tutti e due o nessuno, con un annulla solo per i due file.
// Qui la strada dal client, come «Sposta in…» (`move-block.ts`): il testo non
// salvato si mette in salvo (il comando legge il disco, e controlla che fra
// quei byte ci sia ancora la tabella), la scrittura della nota si annuncia
// alla sua sessione, così la ricarica che ne viene non si dice, e l'esito si
// racconta con «Annulla».
import { COMMANDS } from "../host/contract";
import { errorText } from "../host/errors";
import { api } from "../host/ipc";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { expectDocumentWrite, flushPendingSave } from "./document-session";
import { openVaultRoot } from "./store";
import { refreshDocuments, undoLastOperation } from "./vault";
import { liveStrings } from "../editors/text/profiles/markdown/strings";
import type { TableSheetRequest } from "../editors/text/profiles/markdown/table-sheet";

/// Trasforma la tabella: `null` se è andata, altrimenti la frase che dice
/// perché no (e la nota è com'era, il foglio non c'è).
export async function tableToSheet(request: TableSheetRequest): Promise<string | null> {
  const pending = await flushPendingSave();
  if (pending.length > 0) return liveStrings.t("table_sheet.unsaved", { doc: pending.join(", ") });
  const withdraw = expectDocumentWrite(request.doc);
  try {
    const outcome = await api.invokeCommand(
      COMMANDS.tableSheet,
      { doc: request.doc, at: [...request.at], text: request.text, cells: JSON.stringify(request.cells) },
      undefined,
      openVaultRoot(),
    );
    refreshDocuments();
    if (outcome.notify) {
      notify(outcome.notify, "info", outcome.undo === null ? undefined : {
        label: t("app.undo"),
        run: () => {
          // L'annulla riscrive la nota: la sessione aperta ricarica senza dirlo.
          const back = expectDocumentWrite(request.doc);
          void undoLastOperation().catch((error: unknown) => {
            back();
            // La frase del comando dice già che cosa non è stato toccato.
            notify(errorText(error), "guasto");
          });
        },
      });
    }
    return null;
  } catch (error) {
    withdraw();
    return errorText(error);
  }
}
