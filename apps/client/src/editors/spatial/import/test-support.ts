// Gli strumenti dei test dell'importazione: gli id che contano, perché un
// disegno importato due volte sia lo stesso testo, e lo `Setup` dello
// scrittore come lo dà l'editor, col metro delle prove.

import type { IdKind } from "../scene/ids";
import { drawStrings, t } from "../strings";
import { NewIds } from "../tools/edit";
import { estimate } from "../tools/measure";
import type { Setup } from "./write";

/// Il prefisso degli id di ogni genere, come in `scene/ids.ts`.
const PREFIX: Readonly<Record<IdKind, string>> = { object: "o", layer: "l", resource: "r", board: "b", paper: "c" };

/// Gli id nuovi in fila: il prefisso del genere e otto caratteri base 36 che
/// contano, saltando quelli che ci sono già.
export class CountingIds extends NewIds {
  private count = 0;

  constructor(private readonly busy: (id: string) => boolean) {
    super(busy);
  }

  override next(kind: IdKind): string {
    for (;;) {
      const id = PREFIX[kind] + (++this.count).toString(36).padStart(8, "0");
      if (!this.busy(id)) return id;
    }
  }
}

/// Lo `Setup` di un disegno che si chiama `title`: i nomi di partenza
/// dell'editor in italiano, il metro delle prove e gli id che contano.
export function testSetup(title: string): Setup {
  return {
    title,
    measure: estimate,
    layerName: (n) => t("draw.layer.default", { n }),
    boardName: (n) => t("draw.board.name", { n }),
    shapeName: (key) => drawStrings.catalogFor("it")[key] ?? key,
    ids: (taken) => new CountingIds(taken),
  };
}
