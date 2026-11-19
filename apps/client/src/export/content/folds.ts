// I ripiegabili (E28, T74; il prototipo «Ripiegabili: Aperti, Solo il
// titolo», `.ptog`, passo 29).
//
// Nella nota un ripiegabile (`<details>`, K2) è aperto o chiuso secondo il
// file; sulla carta non si apre con un clic, e la scelta vale per tutti:
// aperti, col titolo e ciò che c'è dentro, o chiusi, col titolo solo e la
// freccia che dice che dentro c'è altro. Anche quelli dentro un altro
// ripiegabile o in una nota riportata.

import type { ContentChanges } from "./changes";
import type { FoldsChoice } from "./choices";

export function applyFolds(page: HTMLElement, choice: FoldsChoice, changes: ContentChanges): number {
  const open = choice === "aperti";
  let changed = 0;
  for (const details of page.querySelectorAll("details")) {
    if (details.open === open) continue;
    changes.attribute(details, "open", open ? "" : null);
    changed++;
  }
  return changed;
}
