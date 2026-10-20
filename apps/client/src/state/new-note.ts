// La nota nuova nello spazio attivo: il gesto di `shell.note.new`, uguale per
// ogni shell che lo offre.
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { focusEditor, openDocument } from "./document-controller";
import { state } from "./store";
import { createNote, folderOfOpenNote } from "./vault";

export async function newNoteInActiveSpace(): Promise<void> {
  try {
    // Una cartella delle nuove note con `./` segue la nota aperta, e vince
    // sullo spazio: è la scelta esplicita di chi lavora per progetto.
    const created = await createNote(undefined, (await folderOfOpenNote()) ?? state.activeSpace ?? undefined);
    if (created) await openDocument(created);
    focusEditor();
  } catch (error) {
    notify(t("explorer.create_failed", { reason: errorText(error) }), "guasto");
  }
}
