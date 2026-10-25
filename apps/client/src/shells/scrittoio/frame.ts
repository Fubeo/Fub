// La cornice dello Scrittoio: ciò che sta attorno ai fogli e che la shell
// comune non disegna. Marchio e menu, chip del vault, indietro e avanti,
// pillola, ispettore e le schede del documento, piede del binario, banda di
// stato.
//
// Ogni pezzo riceve la vita della cornice e non ne apre una sua: smontare la
// shell smonta tutto insieme. Nessun pezzo possiede dati: legge lo store, il
// registro dei comandi e gli attributi che scrive la shell comune.
import type { Lifetime } from "../../ui/lifetime";
import { mountBrandMenu } from "./frame/brand-menu";
import { mountDocumentPanels } from "./frame/document-panels";
import { mountDrawerPeek } from "./frame/peek";
import { mountPill } from "./frame/pill";
import { mountRailFoot, mountRailNotch } from "./frame/rail";
import { mountStatusBand } from "./frame/status-band";
import { mountFrameNav, mountInspectorToggle } from "./frame/titlebar-buttons";
import { mountVaultChip } from "./frame/vault-chip";
import { mountWelcome } from "./frame/welcome";
import { mountFrameIcons } from "./icons";

export function mountFrame(lifetime: Lifetime): void {
  mountFrameIcons(lifetime);
  mountBrandMenu(lifetime);
  mountVaultChip(lifetime);
  mountFrameNav(lifetime);
  mountPill(lifetime);
  mountInspectorToggle(lifetime);
  mountRailFoot(lifetime);
  mountRailNotch(lifetime);
  mountStatusBand(lifetime);
  mountDocumentPanels(lifetime);
  mountWelcome(lifetime);
  mountDrawerPeek(lifetime);
}
