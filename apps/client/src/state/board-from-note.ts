// «Porta su una lavagna» (E25, T48): i blocchi scelti di una nota diventano
// schede di una lavagna col comando del nucleo `canvas.from_note`, che scrive
// la nota e la lavagna tutte e due o nessuna, con un annulla solo. Qui la
// strada dal client, come per «Sposta in…» (`move-block.ts`): il testo non
// salvato si mette in salvo (il comando legge il disco, e controlla che fra
// quei byte ci siano ancora i blocchi), le scritture si annunciano alle
// sessioni aperte, così la ricarica che ne viene non si dice, la lavagna nuova
// si apre a lato e l'esito si racconta con «Annulla».
import { COMMANDS } from "../host/contract";
import { errorText } from "../host/errors";
import { api } from "../host/ipc";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { expectDocumentWrite, flushPendingSave } from "./document-session";
import { openVaultRoot } from "./store";
import { refreshDocuments, undoLastOperation } from "./vault";
import type { BoardPort, BoardRequest } from "../editors/text/profiles/markdown/blocks/to-board";

/// La porta dei Blocchi: `openBeside` apre la lavagna nuova accanto alla nota
/// (lo dà chi tiene i riquadri, senza che questo modulo lo importi).
export function boardBlockPort(openBeside: (doc: string) => Promise<void>): BoardPort {
  return { carry: (request) => carryToBoard(request, openBeside) };
}

/// Porta i blocchi: `null` se è andata, altrimenti la frase che dice perché
/// no (e i due file sono com'erano).
export async function carryToBoard(request: BoardRequest, openBeside: (doc: string) => Promise<void>): Promise<string | null> {
  const pending = await flushPendingSave();
  if (pending.length > 0) return t("document.unsaved_blocks", { doc: pending.join(", ") });
  // La lavagna nuova non ha sessioni da avvisare: nasce dopo.
  const docs = request.to === null ? [request.doc] : [request.doc, request.to];
  const withdraw = docs.map((doc) => expectDocumentWrite(doc));
  let outcome;
  try {
    outcome = await api.invokeCommand(
      COMMANDS.fromNote,
      {
        doc: request.doc,
        at: [...request.at],
        text: request.text,
        ...(request.to === null ? {} : { to: request.to }),
        keep: request.keep,
      },
      undefined,
      openVaultRoot(),
    );
  } catch (error) {
    for (const each of withdraw) each();
    return errorText(error);
  }
  refreshDocuments();
  const created = outcome.effect.kind === "navigate" ? outcome.effect.doc : null;
  if (outcome.notify) {
    const written = created === null ? docs : [...docs, created];
    notify(outcome.notify, "info", outcome.undo === null ? undefined : {
      label: t("app.undo"),
      run: () => {
        // Anche l'annulla riscrive i due file: le sessioni aperte ricaricano
        // senza dirlo.
        const back = written.map((doc) => expectDocumentWrite(doc));
        void undoLastOperation().catch((error: unknown) => {
          for (const each of back) each();
          notify(t("trash.undo_failed", { reason: errorText(error) }), "guasto");
        });
      },
    });
  }
  // La lavagna è scritta: se non si apre, lo si dice, ma i blocchi ci sono.
  if (created !== null) {
    await openBeside(created).catch((error: unknown) => notify(errorText(error), "guasto"));
  }
  return null;
}
