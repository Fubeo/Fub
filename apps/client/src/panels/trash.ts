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
import { confirm } from "../host/dialog";
import { beforeNote, refreshDocuments, trashNote } from "../state/vault";
import { pageName } from "../rules/organizer";
import { activeDoc } from "../state/layout";
import { closeDocument, isOpen, openDocument } from "./document";
import { documentSessions } from "../state/document-session";
import { t } from "../i18n/strings";

/// Cestina una nota, chiedendo prima conferma. La sessione sospende i ritardi
/// durante la domanda e invalida il documento prima del comando distruttivo.
export async function trashWithConfirm(id: string): Promise<void> {
  // A second gesture for the same open document must not create a second
  // confirmation or race the first destructive command. An unopened document
  // has no owner, so its `beginDeletion` rejection is intentionally ignored.
  if (documentSessions.isDeletionPending(id)) return;
  documentSessions.beginDeletion(id);
  const wasOpen = isOpen(id);

  const ok = await confirm(t("trash.confirm_delete", { doc: pageName(id) }), {
    title: t("trash.delete_title"),
    danger: true,
    okLabel: t("explorer.delete"),
  });
  if (!ok) {
    documentSessions.cancelDeletion(id);
    return;
  }

  const outcome = await documentSessions.delete(id, (currentId) => trashNote(currentId));
  if (outcome.kind !== "deleted") return;
  // La sessione ha già invalidato buffer, ritardi e bozza; qui restano soltanto
  // gli effetti delle superfici e dell'elenco delle note.
  if (isOpen(id)) closeDocument(id);
  refreshDocuments();
  if (wasOpen && !activeDoc()) {
    // La prima nota che c'è, chiesta con una finestra da uno, prendere il primo
    // elemento di un elenco intero era chiedere il vault per aprirne una (§14.4).
    const first = await beforeNote();
    if (first) await openDocument(first);
  }
}
