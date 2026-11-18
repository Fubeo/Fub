// Il blocco sincronizzato (E14, T30) dal lato del client: il comando del
// nucleo `note.block.sync` dà l'id al blocco e scrive la sua trasclusione in
// fondo all'altra nota, tutte e due o nessuna, con un annulla solo; senza
// nota d'arrivo dà soltanto l'id (il «/» «Blocco di un'altra nota»). Qui la
// strada dal client, come per «Sposta in…» (`move-block.ts`): il testo non
// salvato si mette in salvo prima (il comando legge il disco e controlla che
// fra quei byte ci sia ancora il blocco), le scritture si annunciano alle
// sessioni aperte, così la ricarica che ne viene non si dice, e l'esito si
// racconta con «Annulla».
import { COMMANDS } from "../host/contract";
import { errorText, isErrorKind } from "../host/errors";
import { api } from "../host/ipc";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { expectDocumentWrite, flushPendingSave } from "./document-session";
import { moveNotes } from "./move-block";
import { openVaultRoot } from "./store";
import { refreshDocuments, undoLastOperation } from "./vault";
import type { BlockIdRequest, SyncBlockPort, SyncRequest } from "../editors/text/profiles/markdown/blocks/sync-to";

/// Mette in salvo il testo non salvato: `null` se è andata, altrimenti la
/// frase che dice quali note non si sono salvate.
async function settled(): Promise<string | null> {
  const pending = await flushPendingSave();
  return pending.length > 0 ? t("document.unsaved_blocks", { doc: pending.join(", ") }) : null;
}

/// Invoca il comando sulle note `docs`, annunciandone le scritture: `null`
/// se è andata, altrimenti il perché no: la frase, e l'errore del comando se
/// è stato lui (le note sono com'erano). `told` dice se l'esito buono si
/// racconta, col suo «Annulla».
async function invokeOn(args: Record<string, unknown>, docs: readonly string[], told: boolean): Promise<Refused | null> {
  const unsaved = await settled();
  if (unsaved !== null) return { reason: unsaved, error: null };
  const withdraw = docs.map((doc) => expectDocumentWrite(doc));
  try {
    const outcome = await api.invokeCommand(COMMANDS.syncBlock, args, undefined, openVaultRoot());
    // Niente annulla, niente scritture (l'id c'era già): nessuna ricarica
    // da aspettare.
    if (outcome.undo === null) for (const each of withdraw) each();
    refreshDocuments();
    if (told && outcome.notify) {
      notify(outcome.notify, "info", outcome.undo === null ? undefined : {
        label: t("app.undo"),
        run: () => {
          // Anche l'annulla riscrive le note: le sessioni aperte ricaricano
          // senza dirlo.
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
    return { reason: errorText(error), error };
  }
}

/// Il perché no di `invokeOn`.
interface Refused {
  readonly reason: string;
  readonly error: unknown;
}

/// «Sincronizza in un'altra nota»: l'id al blocco se manca e la trasclusione
/// in fondo a `to`.
export async function syncBlock(request: SyncRequest): Promise<string | null> {
  const refused = await invokeOn(
    { doc: request.doc, at: [...request.at], text: request.text, to: request.to },
    [request.doc, request.to],
    true,
  );
  return refused?.reason ?? null;
}

/// L'id `id` al blocco, se non ce l'ha: chi chiama scrive poi il riferimento
/// nel proprio testo. In silenzio: ciò che si vede è il riferimento.
export async function giveBlockId(request: BlockIdRequest): Promise<string | null> {
  return (await giveBlockIdTold(request))?.reason ?? null;
}

/// Come `giveBlockId`, e dice anche se la nota del blocco si legge soltanto
/// (il comando non ha potuto scriverla): `[[^^` allora offre il link alla
/// sezione (T31).
export async function giveBlockIdTold(request: BlockIdRequest): Promise<{ reason: string; readOnly: boolean } | null> {
  const refused = await invokeOn({ doc: request.doc, at: [...request.at], text: request.text, id: request.id }, [request.doc], false);
  return refused === null ? null : { reason: refused.reason, readOnly: isErrorKind(refused.error, "permission_denied") };
}

/// Il testo di una nota com'è sul disco, dopo aver messo in salvo quello non
/// salvato: i byte che il comando controllerà.
async function noteSource(doc: string): Promise<string> {
  const unsaved = await settled();
  if (unsaved !== null) throw new Error(unsaved);
  return (await api.readDocument(doc, openVaultRoot())).text;
}

/// La porta che l'editor riceve.
export const syncBlockPort: SyncBlockPort = {
  notes: moveNotes,
  sync: syncBlock,
  source: noteSource,
  giveId: giveBlockId,
};
