// La nota nuova nello spazio attivo: il gesto di `shell.note.new` e di «Nuova
// nota» del cassetto, uguale per ogni shell che lo offre.
//
// Con dei tipi di nota nel vault (E5) il gesto chiede prima il tipo, in un
// menu sotto il pulsante: Invio tiene la nota semplice, Esc non crea niente.
// Senza tipi la domanda non c'è e la nota nasce subito, come prima. Una nota
// di un tipo nasce dal comando del core (`note.from_type`): le proprietà del
// tipo, il suo modello, la sua cartella, e un nome libero (un file che c'è non
// si sovrascrive mai).
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import type { PopoverAnchor } from "../kit";
import { chooseNoteType } from "../ui/note-type-menu";
import { notify } from "../ui/notify";
import { focusEditor, openDocument } from "./document-controller";
import { createFromType, listNoteTypes, NO_TYPES, type NoteType, type NoteTypeList } from "./note-types";
import { state } from "./store";
import { createNote, folderOfOpenNote, refreshDocuments } from "./vault";

/// Chi sa chiedere il tipo: il menu della shell, o un finto nei test.
export type TypeChooser = (list: NoteTypeList, anchor: PopoverAnchor) => Promise<NoteType | null | undefined>;

export interface NewNoteOptions {
  /// Sotto che cosa si apre la domanda del tipo. Di serie il pulsante «Nuova
  /// nota» del cassetto, se si vede; se no la cima della finestra.
  readonly anchor?: PopoverAnchor;
  /// La cartella della nota semplice e di quella di un tipo che non ne dice
  /// una. Di serie quella della nota aperta (`./`) o lo spazio attivo.
  readonly folder?: string | null;
  readonly choose?: TypeChooser;
  /// Appena la nota è nata, prima di aprirla (l'albero apre la sua cartella).
  readonly beforeOpen?: (doc: string) => void;
}

export async function newNoteInActiveSpace(options: NewNoteOptions = {}): Promise<void> {
  try {
    // Una cartella delle nuove note con `./` segue la nota aperta, e vince
    // sullo spazio: è la scelta esplicita di chi lavora per progetto.
    const folder = options.folder !== undefined
      ? options.folder ?? undefined
      : (await folderOfOpenNote()) ?? state.activeSpace ?? undefined;
    // I tipi non si leggono? La nota semplice nasce lo stesso: la domanda è
    // un aiuto, non un cancello.
    const list = await listNoteTypes().catch(() => NO_TYPES);
    let created: string | null;
    if (list.types.length === 0) {
      created = await createNote(undefined, folder);
    } else {
      const chosen = await (options.choose ?? chooseNoteType)(list, options.anchor ?? newNoteAnchor());
      if (chosen === undefined) return;
      created = chosen === null ? await createNote(undefined, folder) : await createFromType(chosen, folder);
      if (chosen !== null) refreshDocuments();
    }
    if (created) {
      options.beforeOpen?.(created);
      await openDocument(created);
    }
    focusEditor();
  } catch (error) {
    notify(t("explorer.create_failed", { reason: errorText(error) }), "guasto");
  }
}

/// Il pulsante «Nuova nota» se si vede; se no un punto in cima al centro della
/// finestra, perché la domanda arrivata da una scorciatoia sia dove si guarda.
function newNoteAnchor(): PopoverAnchor {
  const button = document.getElementById("new-note");
  if (button && button.getClientRects().length > 0) return button;
  return {
    getBoundingClientRect: () => {
      const left = Math.round(window.innerWidth / 2) - 150;
      const top = Math.round(window.innerHeight / 6);
      return { left, top, width: 0, height: 0 };
    },
  };
}
