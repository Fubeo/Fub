// I due pannelli laterali — la sidebar e l'ispettore — come gesti.
//
// Chi possiede la regola è la shell adattiva (`desktop-shell.ts`): sa dove
// passano i breakpoint, quando un pannello è affiancato e quando è un
// cassetto. Chi chiede un pannello (un comando, la rail, il trigger della
// ricerca) non sa niente di tutto questo: dice «mostralo» o «alternalo», e il
// controller registrato decide se allargare il layout o aprire il cassetto.
import type { Teardown } from "./lifetime";

export type SidePanel = "sidebar" | "inspector";

export interface SidePanelController {
  /// Il pannello si vede adesso, affiancato o come cassetto.
  visible(side: SidePanel): boolean;
  /// Mostra il pannello; a finestra stretta apre il cassetto.
  reveal(side: SidePanel): void;
  /// Mostra o nasconde il pannello.
  toggle(side: SidePanel): void;
  /// Chi ha scelto nel pannello qualcosa che si mostra fuori (un documento
  /// dall'albero) lo dice: un cassetto sovrapposto si chiude e lascia il
  /// fuoco a chi lo prende, un pannello affiancato resta com'è.
  dismiss(side: SidePanel): void;
}

let controller: SidePanelController | null = null;

/// Registra il proprietario; il teardown lo toglie solo se è ancora lui.
export function setSidePanelController(next: SidePanelController): Teardown {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

export function sidePanelVisible(side: SidePanel): boolean {
  return controller?.visible(side) ?? true;
}

export function revealSidePanel(side: SidePanel): void {
  controller?.reveal(side);
}

export function toggleSidePanel(side: SidePanel): void {
  controller?.toggle(side);
}

export function dismissSidePanel(side: SidePanel): void {
  controller?.dismiss(side);
}
