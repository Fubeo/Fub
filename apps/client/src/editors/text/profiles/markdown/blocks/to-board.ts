// «Porta su una lavagna» (E25, T48) dal lato dell'editor: i blocchi scelti,
// detti in byte del file, vanno su una lavagna col comando del nucleo
// `canvas.from_note`, che scrive la nota e la lavagna insieme e dà un annulla
// solo. Una scheda per blocco, nello stesso ordine; un titolo porta la sua
// sezione; un file incorporato resta lo stesso file. Le regole stanno nel
// comando (`crates/fub-features/src/lavagna/note.rs`): qui non si tocca il
// documento, lo ricarica la sessione dopo la scrittura. La porta la dà chi
// monta l'editor (`state/board-from-note.ts`): l'editor non parla con l'host.
import type { EditorState } from "@codemirror/state";
import { icon, registerIcon } from "../../../../../ui/icons";
import type { Block } from "./model";
import type { BlockRun } from "./move";

/// I blocchi da portare, e dove.
export interface BoardRequest {
  /// La nota, e i byte della scelta col testo che ci si è letto: se la nota
  /// è cambiata nel frattempo il comando non muove niente.
  readonly doc: string;
  readonly at: readonly [number, number];
  readonly text: string;
  /// La lavagna dove vanno le schede; `null` per una lavagna nuova accanto
  /// alla nota, che si apre a lato.
  readonly to: string | null;
  /// I blocchi restano anche nella nota (il trascinamento con Ctrl).
  readonly keep: boolean;
}

/// Chi porta davvero. `carry` dà `null` se è andata, altrimenti la frase che
/// dice perché no (e i due file sono com'erano).
export interface BoardPort {
  carry(request: BoardRequest): Promise<string | null>;
}

/// Un embed wiki solo nella riga, o più embed affiancati: una scheda viva.
const CARD_LINE = /^\s*!\[\[[^\]\n]+\]\](?:\s*!\[\[[^\]\n]+\]\])*\s*$/;

/// La tratta ha almeno una scheda viva di primo livello: un paragrafo fatto
/// soltanto di embed (`![[Conti.xlsx]]`, due schede affiancate). È dove il
/// menu del blocco offre «Porta su una lavagna», come nel prototipo.
export function hasCard(state: EditorState, blocks: readonly Block[], run: BlockRun): boolean {
  for (let i = run.first; i <= run.last; i++) {
    const block = blocks[i];
    if (block?.kind === "paragraph" && CARD_LINE.test(state.sliceDoc(block.from, block.to))) return true;
  }
  return false;
}

/// La figura della voce, quella del prototipo (`i-board`: tre colonne di
/// schede), sulla griglia di 24 delle icone dell'app. Si registra la prima
/// volta che serve, se il repertorio non ne ha già una (un tema può averla
/// ridisegnata). Dà sempre `true`, per stare dentro la condizione della voce.
export function registerBoardIcon(): true {
  if (icon("board") === "") {
    registerIcon("board", [
      "M4.5 3.75h2.1a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5h-2.1a1.5 1.5 0 0 1-1.5-1.5V5.25a1.5 1.5 0 0 1 1.5-1.5z",
      "M10.95 3.75h2.1a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-2.1a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5z",
      "M17.4 3.75h2.1a1.5 1.5 0 0 1 1.5 1.5v10.5a1.5 1.5 0 0 1-1.5 1.5h-2.1a1.5 1.5 0 0 1-1.5-1.5V5.25a1.5 1.5 0 0 1 1.5-1.5z",
    ]);
  }
  return true;
}
