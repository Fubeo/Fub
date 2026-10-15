// Cestinare una nota: il **gesto**, che è tutto ciò che di questo file resta.
//
// # Il pannello se n'è andato, e non è stato spostato: è stato tolto
//
// Il cestino era un pannello nativo di questa shell — 169 righe che elencavano
// `list_trash`, disegnavano una riga per voce, chiedevano conferma con la modale
// e proponevano un nome libero. Dal §1.2 è un `ViewProvider`
// (`crates/fub-features/src/trash.rs`) e arriva qui per la stessa strada di
// backlink, struttura, tag e statistiche: `mountDeclaredViews` lo scopre, lo
// mette dove la sua `ViewSpec` dice, e nessuna riga di questo bundle sa che
// esiste. Le due domande che sembravano volere la modale — *«svuoto davvero?»* e
// *«il path è occupato: che nome le do?»* — si disegnano nell'albero, ed è la
// cosa che quella migrazione ha deciso.
//
// Quel che **non** poteva andarsene è questo: cestinare è un gesto della shell
// su un documento che la shell ha aperto. Chiede conferma, disinnesca un
// salvataggio in volo e, se la nota cestinata era quella a schermo, decide cosa
// mettere al suo posto — tre cose che vivono di qua dal confine e che un
// provider non ha modo di fare. Il comando che scrive, invece, è del registro
// (`note.trash`) e lo era già.
import { confirm } from "../platform/confirm";
import { refreshDocuments, trashesToSystem, trashNote, undoLastOperation } from "../state/vault";
import { pageName } from "../rules/organizer";
import { closeDocument, isOpen } from "../state/document-controller";
import { documentSessions } from "../state/document-session";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { errorText } from "../host/errors";

/// Cestina una nota. Il cestino del vault è reversibile — dall'«Annulla»
/// dell'avviso o dal pannello Cestino — quindi non chiede conferma; quello del
/// sistema porta la nota fuori dal vault, e lì la domanda resta. La sessione
/// sospende i ritardi durante la domanda e invalida il documento prima del
/// comando distruttivo.
export async function trashWithConfirm(id: string): Promise<void> {
  // A second gesture for the same open document must not create a second
  // confirmation or race the first destructive command. An unopened document
  // has no owner, so its `beginDeletion` rejection is intentionally ignored.
  if (documentSessions.isDeletionPending(id)) return;
  documentSessions.beginDeletion(id);

  if (await trashesToSystem()) {
    // Una domanda che non si riesce a fare vale «no»: senza risposta la nota
    // resterebbe in cancellazione pendente, cioè in sola lettura e con
    // salvataggio e bozza sospesi, per un gesto che nessuno ha confermato.
    const ok = await confirm(t("trash.confirm_delete", { doc: pageName(id) }), {
      title: t("trash.delete_title"),
      okLabel: t("explorer.delete"),
    }).catch(() => false);
    if (!ok) {
      documentSessions.cancelDeletion(id);
      return;
    }
  }

  let undo: Awaited<ReturnType<typeof trashNote>> = null;
  const outcome = await documentSessions.delete(id, async (currentId) => {
    undo = await trashNote(currentId);
  });
  if (outcome.kind !== "deleted") return;
  // La sessione ha già invalidato buffer, ritardi e bozza; qui restano soltanto
  // gli effetti delle superfici e dell'elenco delle note. Il riquadro rimasto
  // senza tab mostra il suo stato vuoto: aprire una nota qualunque al posto di
  // quella cestinata sarebbe una scelta che nessuno ha fatto.
  if (isOpen(id)) closeDocument(id);
  refreshDocuments();
  notify(
    t("trash.moved", { doc: pageName(id) }),
    "info",
    undo
      ? {
        label: t("app.undo"),
        run: () => undoLastOperation().catch((error: unknown) =>
          notify(t("trash.undo_failed", { reason: errorText(error) }), "guasto")),
      }
      : undefined,
  );
}

/// Cestina più note scelte insieme: una domanda sola (quando il cestino è del
/// sistema) e poi lo stesso percorso della nota singola per ognuna, in fila.
///
/// Non c'è un «Annulla» unico: l'annullamento del vault disfa l'ultima
/// operazione, e disfarne tante con un gesto vorrebbe dire sceglierne l'ordine.
/// Le note sono nel cestino del vault, e di lì tornano una a una. Un guasto su
/// una nota non ferma le altre: si dice alla fine quante sono andate.
export async function trashManyWithConfirm(ids: readonly string[]): Promise<number> {
  // Una nota già in cancellazione ha il suo gesto in corso: non se ne apre un
  // secondo (stessa regola del gesto singolo).
  const mine = [...new Set(ids)].filter((id) => !documentSessions.isDeletionPending(id));
  if (mine.length === 0) return 0;
  for (const id of mine) documentSessions.beginDeletion(id);

  if (await trashesToSystem()) {
    const ok = await confirm(t("trash.confirm_delete_many", { n: String(mine.length) }), {
      title: t("trash.delete_title_many"),
      okLabel: t("explorer.delete"),
    }).catch(() => false);
    if (!ok) {
      for (const id of mine) documentSessions.cancelDeletion(id);
      return 0;
    }
  }

  let done = 0;
  const failed: string[] = [];
  for (const id of mine) {
    try {
      const outcome = await documentSessions.delete(id, async (currentId) => {
        await trashNote(currentId);
      });
      if (outcome.kind !== "deleted") {
        failed.push(id);
        continue;
      }
      if (isOpen(id)) closeDocument(id);
      done += 1;
    } catch {
      // La nota è rimasta dov'era: torna scrivibile, e se ne parla alla fine.
      documentSessions.cancelDeletion(id);
      failed.push(id);
    }
  }
  refreshDocuments();
  if (done > 0) notify(t("trash.moved_many", { n: String(done) }), "info");
  if (failed.length > 0) {
    notify(t("trash.failed_many", { n: String(failed.length), docs: failed.map(pageName).join(", ") }), "guasto");
  }
  return done;
}
