// I fogli dello Scrittoio: ciò che la shell aggiunge alla vista dei riquadri.
//
// La vista (`panels/document.ts`) disegna linguette, testata e contenuto, e il
// controllore (`state/document-controller.ts`) ne possiede lo stato. Qui sta
// solo ciò che è di questa cornice — il movimento delle linguette, il «+» — e
// si appoggia al DOM che la vista scrive, senza possederlo.
import type { Lifetime } from "../../ui/lifetime";
import { mountDesk } from "./sheets/desk";
import { mountHeadingThread } from "./sheets/heading-thread";
import { mountLinkCards } from "./sheets/link-card";
import { mountLinkDrag } from "./sheets/link-drag";
import { mountSaveState } from "./sheets/save-state";
import { mountTabDrop } from "./sheets/tab-drop";
import { mountTabStrips } from "./sheets/tab-strip";
import { mountTitleRename } from "./sheets/title-rename";

export function mountSheets(lifetime: Lifetime): void {
  mountTabStrips(lifetime);
  mountTabDrop(lifetime);
  mountSaveState(lifetime);
  mountTitleRename(lifetime);
  mountDesk(lifetime);
  mountHeadingThread(lifetime);
  mountLinkCards(lifetime);
  mountLinkDrag(lifetime);
}
