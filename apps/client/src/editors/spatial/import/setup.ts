// Lo `Setup` dello scrittore che usano la finestra d'importazione e
// l'incolla da un altro programma.

import { resolvedLanguage } from "../../../i18n/strings";
import { drawStrings, t as drawT } from "../strings";
import { browserMeasure, estimate } from "../tools/measure";
import type { Setup } from "./write";

/// Lo `Setup` dello scrittore per un disegno che si chiama `title`: i nomi di
/// partenza dell'editor nella lingua dell'interfaccia, e la misura del
/// browser coi caratteri già letti.
export function setupFor(title: string): Setup {
  const strings = drawStrings.catalogFor(resolvedLanguage());
  return {
    title,
    measure: browserMeasure() ?? estimate,
    layerName: (n) => drawT("draw.layer.default", { n }),
    boardName: (n) => drawT("draw.board.name", { n }),
    shapeName: (key) => strings[key] ?? key,
  };
}
