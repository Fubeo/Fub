// Le interruzioni di pagina volute, come scatole speciali (E28, «Interruzioni»).
//
// Le regole dell'impaginazione (`rules.ts`) valgono sempre; le interruzioni
// invece si scelgono: «Ogni Titolo 2 comincia una pagina», «Il separatore
// comincia una pagina» (com'è nella stampa di oggi: `---` non si disegna,
// volta pagina) e i punti scelti a mano sulla pagina (D17: `<!-- pagina -->`
// nella nota, che la resa per la stampa dà come scatola `break` «mano», T76).
// Qui le prime due diventano scatole `break` prima dell'impaginazione; due
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

/// Le scatole con le interruzioni scelte: un `break` «titolo2» prima di ogni
/// Titolo 2, il separatore sostituito da un `break` «separatore». Le
/// interruzioni a mano restano dove sono.
export function applyBreaks(boxes: readonly Box[], settings: BreakSettings): Box[] {
  const out: Box[] = [];
  for (const box of boxes) {
    if (box.kind === "heading" && box.level === 2 && settings.everyHeading2) {
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
