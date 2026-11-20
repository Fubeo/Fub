// Le interruzioni di pagina volute, come scatole speciali (E28, «Interruzioni»).
//
// Le regole dell'impaginazione (`rules.ts`) valgono sempre; le interruzioni
// invece si scelgono: «Ogni Titolo 2 comincia una pagina», «Il separatore
// comincia una pagina» (com'è nella stampa di oggi: `---` non si disegna,
// volta pagina) e i punti scelti a mano sulla pagina (D17: `<!-- pagina -->`
// nella nota, T76). Quest'ultima la resa per la stampa del core la dà come un
// segnaposto vuoto `data-page-break`, che la misura descrive come un
// separatore alto zero con l'identità `pagina:…` (`MANUAL_BREAK_PREFIX`):
// volta sempre pagina, qualunque sia la regolazione del separatore.
// Qui tutte diventano scatole `break` prima dell'impaginazione; due
// interruzioni di fila, o una in cima, non fanno pagine bianche (lo garantisce
// `paginate`).

import type { Box, BreakBox } from "./model";

/// Le due interruzioni che si scelgono. Il profilo dell'esportazione (T68) le
/// terrà fra le sue regolazioni; qui sono un parametro, per non anticiparne
/// la forma.
export interface BreakSettings {
  /// Ogni Titolo 2 comincia una pagina.
  readonly everyHeading2: boolean;
  /// Il separatore volta pagina invece di disegnare una linea.
  readonly separator: boolean;
}

/// L'inizio dell'identità del separatore fra due note di un PDF di più note
/// (`export/book.ts`): volta sempre pagina, qualunque sia la regolazione del
/// separatore, perché ogni nota comincia su una pagina sua.
export const CHAPTER_BREAK_PREFIX = "capitolo:";

/// L'inizio dell'identità dell'interruzione messa a mano (`<!-- pagina -->`,
/// D17): la misura (`PrintMeasure`) la dà a un separatore alto zero.
export const MANUAL_BREAK_PREFIX = "pagina:";

/// Le scatole con le interruzioni scelte: un `break` «titolo2» prima di ogni
/// Titolo 2, il separatore sostituito da un `break` «separatore», quello fra
/// due note da un `break` «capitolo», quello messo a mano da un `break`
/// «mano», al suo posto.
export function applyBreaks(boxes: readonly Box[], settings: BreakSettings): Box[] {
  const out: Box[] = [];
  for (const box of boxes) {
    if (box.kind === "separator" && box.id.startsWith(CHAPTER_BREAK_PREFIX)) {
      out.push(breakBox(box.id, "capitolo"));
    } else if (box.kind === "separator" && box.id.startsWith(MANUAL_BREAK_PREFIX)) {
      out.push(breakBox(box.id, "mano"));
    } else if (box.kind === "heading" && box.level === 2 && settings.everyHeading2) {
      out.push(breakBox(`${box.id}#pagina`, "titolo2"));
      out.push(box);
    } else if (box.kind === "separator" && settings.separator) {
      out.push(breakBox(box.id, "separatore"));
    } else out.push(box);
  }
  return out;
}

function breakBox(id: string, reason: BreakBox["reason"]): BreakBox {
  return { kind: "break", id, reason };
}
