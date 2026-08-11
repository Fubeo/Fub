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
import { primaNota, refreshDocuments, trashNote } from "../state/vault";
import { pageName } from "../rules/organizer";
import { docAttivo } from "../state/layout";
import { closeDocument, isOpen, openDocument, resumeSave, suspendSave } from "./document";
import { t } from "../i18n/strings";

/// Cestina una nota, chiedendo prima conferma.
///
/// Un salvataggio in attesa su quel documento lo farebbe risorgere subito dopo
/// la cancellazione: si disinnesca **prima ancora di chiedere**, e lo si rimette
/// in coda se l'utente ci ripensa.
///
/// # Si chiude **quella** nota, non quella a schermo
///
/// `isOpen` domanda «è aperta in *qualche* riquadro», e la risposta veniva usata
/// per chiudere il documento **attivo** — che con due riquadri non è lo stesso.
/// Cestinare dall'esploratore una nota aperta nell'altro riquadro chiudeva
/// quella su cui l'utente stava scrivendo, e col buffer sporco dentro: il testo
/// non salvato se ne andava senza che niente lo dicesse, mentre la nota appena
/// cestinata restava a schermo. La frase qui sotto — «il buffer sporco di un
/// documento cancellato muore col documento» — vale solo se il documento è
/// quello cancellato.
///
/// Per la stessa ragione la nota di rimpiazzo si apre **solo se non è rimasto
/// niente**: chiudere una nota in un riquadro che non si guarda non è un motivo
/// per cambiare quello che si guarda.
export async function trashWithConfirm(id: string): Promise<void> {
  const salvataggioInAttesa = suspendSave(id);

  const ok = await confirm(t("trash.confirm_delete", { doc: pageName(id) }), {
    title: t("trash.delete_title"),
    danger: true,
    okLabel: t("explorer.delete"),
  });
  if (!ok) {
    if (salvataggioInAttesa) resumeSave();
    return;
  }

  await trashNote(id);
  const era_aperta = isOpen(id);
  if (era_aperta) {
    // Il buffer sporco di un documento cancellato muore col documento: non è
    // una perdita silenziosa, è l'azione che l'utente ha appena confermato.
    closeDocument(id);
  }
  refreshDocuments();
  if (era_aperta && !docAttivo()) {
    // La prima nota che c'è, chiesta con una finestra da uno: prendere il primo
    // elemento di un elenco intero era chiedere il vault per aprirne una (§14.4).
    const prima = await primaNota();
    if (prima) await openDocument(prima);
  }
}
