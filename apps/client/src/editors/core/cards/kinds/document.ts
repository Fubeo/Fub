// La scheda di documento (E20, T44): un `.docx` o un `.odt` in una scheda,
// nella nota o sulla lavagna.
//
// A riposo il testo del documento reso in continuo, senza pagine: la stessa
// resa della scheda di nota (`renderEmbed` del modello comune, montata con
// la montatura sicura), dal corpo di `note.ts` con la specie del documento.
// Un documento lungo si mostra fino a `DOCUMENT_CARD_MAX_BLOCKS` blocchi; il
// resto si legge con «Apri», che una riga in fondo offre.
//
// Da attiva, dove l'ospite lo chiede (`writes`: la nota sì, la lavagna no,
// D-14 (a)), si scrive con l'editor dei documenti sulla stessa sessione del
// file: la porta delle schede (`CardEditorPort`) monta la superficie ricca
// compatta, cioè in Scrittura (la colonna del tema, senza la carta e senza
// la barra multifunzione, `editors/rich/surface.ts`). Stili e impaginazione
// restano del file: la scheda non li tocca, e il file si salva col suo
// formato come da un riquadro.
//
// La parte `#Titolo` di un embed (`![[Lettera.docx#Saluti]]`): il modello di
// un documento non regge una sezione. `fub-format-rich` dà i titoli
// nell'outline ma ogni blocco ha lo `Span` vuoto (`model.rs`,
// `document_model`), e il ritaglio del kernel sceglie i blocchi per offset
// (`section_of` in `crates/fub-kernel/src/workspace.rs`): darebbe una
// sezione vuota, o il documento intero. Allora la scheda mostra sempre tutto
// il documento, e la parte resta scritta nell'embed e nella testata.

import { t } from "../../../../i18n/strings";
import { markLook } from "../../../../theme/content-look";
import type { Lifetime } from "../../../../ui/lifetime";
import type { CardContext, CardMode, CardRenderer, CardView } from "../contract";
import type { CanvasNode } from "../../../canvas/model";
import { mountTextCard, type NoteCardPort, type TextCardFlavor } from "./note";

/// I blocchi del documento che la scheda mostra al più: un documento di cento
/// pagine non diventa cento pagine di DOM in una colonna. Gli altri restano
/// nella resa ma non si disegnano (`skin/live-cards.css` li nasconde con lo
/// stesso numero), e una riga in fondo offre «Apri».
export const DOCUMENT_CARD_MAX_BLOCKS = 200;

/// Ciò che la scheda di documento chiede a chi la ospita.
export interface DocumentCardPort extends NoteCardPort {
  /// Se la scheda attiva scrive nel documento: la nota sì (T44), la lavagna
  /// no (D-14 (a)). Serve anche la porta per scrivere (`context.editors`).
  readonly writes: boolean;
}

/// Il renderer delle schede di documento.
export function documentCardRenderer(port: DocumentCardPort): CardRenderer {
  const flavor = documentFlavor(port);
  return {
    kinds: ["document"],
    mount(_node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView {
      return mountTextCard(port, host, mode, context, flavor);
    },
  };
}

function documentFlavor(port: DocumentCardPort): TextCardFlavor {
  return {
    kind: "document",
    className: "canvas-card-document",
    writes: () => port.writes,
    sections: false,
    // Senza pagine e senza la barra multifunzione: la scheda è una colonna.
    compact: true,
    // La Scrittura del documento veste il testo col tema (`RICH_MODES`): in
    // un riquadro l'aspetto lo mette la shell, qui la scheda che ospita.
    prepareWriter: (writer) => markLook(writer, "tema"),
    after: (content, life, context) => truncated(content, life, context, port),
  };
}

/// La riga in fondo a un documento che la scheda non mostra tutto: «Apri» lo
/// apre nella sua linguetta, alla parte dell'embed.
function truncated(content: HTMLElement, life: Lifetime, context: CardContext, port: NoteCardPort): readonly Node[] {
  if (content.childElementCount <= DOCUMENT_CARD_MAX_BLOCKS) {
    delete content.dataset.cardTruncated;
    return [];
  }
  content.dataset.cardTruncated = "true";
  const more = document.createElement("div");
  more.className = "canvas-card-document-more";
  const text = document.createElement("span");
  text.textContent = t("canvas.card.document_more");
  more.append(text);
  const open = port.open;
  if (open) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kit-button";
    button.dataset.kind = "normal";
    button.textContent = t("canvas.card.open");
    const { path, subpath } = context;
    life.listen(button, "click", (event) => {
      event.stopPropagation();
      open.call(port, path, subpath);
    });
    more.append(button);
  }
  return [more];
}
