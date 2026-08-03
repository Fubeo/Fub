// Quale dei pannelli della sidebar occupa lo spazio.
//
// I due si escludono a vicenda: uno solo alla volta, e chi ne apre uno non deve
// ricordarsi di chiudere gli altri. Prima la regola stava in `main.ts`, che era
// anche l'unico posto da cui la si poteva invocare; qui è di chiunque ne abbia
// bisogno — ed è il pezzetto di "modello di layout" che questa shell ha
// davvero, in attesa di quello vero (tab, split, pane: FEATURES 3.3, la parte
// del §1.2 lasciata aperta).
import { $ } from "../ui/dom";
import { registerShellCommand } from "../ui/commands";

export type SidebarPanel = "files" | "search";

const panels: Record<SidebarPanel, HTMLElement> = {
  files: $("#files-panel"),
  search: $("#search-panel"),
};

export function showPanel(panel: SidebarPanel): void {
  for (const [nome, el] of Object.entries(panels)) el.hidden = nome !== panel;
}

export function isPanelVisible(panel: SidebarPanel): boolean {
  return !panels[panel].hidden;
}

/// I due pannelli come **comandi** (§18.2), dichiarati da chi possiede la
/// regola che li alterna.
///
/// Stanno qui e non nei due pannelli che mostrano perché è qui che vive
/// `showPanel`: il pannello della ricerca sa cercare, non sa di essere uno di
/// due che si escludono — ed è la stessa ragione per cui quella regola si è
/// spostata fuori da `main.ts` a suo tempo.
export function mountSidebarCommands(): void {
  registerShellCommand({
    id: "shell.panel.files",
    title: "commands.panel.files",
    description: "commands.panel.files.desc",
    run: () => showPanel("files"),
  });
  registerShellCommand({
    id: "shell.panel.search",
    title: "commands.panel.search",
    description: "commands.panel.search.desc",
    run: () => showPanel("search"),
  });
}
