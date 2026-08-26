// Quale dei pannelli della sidebar occupa lo spazio.
//
// I due si escludono a vicenda: uno solo alla volta, e chi ne apre uno non deve
// ricordarsi di chiudere gli altri. Prima la regola stava in `main.ts`, che era
// anche l'unico posto da cui la si poteva invocare; qui è di chiunque ne abbia
// bisogno — ed è il pezzetto di "modello di layout" che questa shell ha
// davvero, in attesa di quello vero (linguetta, split, pane: FEATURES 3.3, la parte
// del §1.2 lasciata aperta).
//
// Dalla §Fase 2 la sidebar ospita anche le view dichiarate `left_sidebar`:
// Template, Collezioni, Cestino. Ognuna monta il proprio pannello in
// `#views-left`, e `showPanel` lo mostra nascondendo files, search e tutte
// le altre view dichiarate. L'id è quello della view (una stringa), e non
// un nome cablato: chi scopre le view dal backend non sa quali ci sono.
import { $ } from "../ui/dom";
import { registerShellCommand } from "../ui/commands";

/// Quale pannello della sidebar è attivo: i due della shell, o l'id di una
/// view dichiarata con `left_sidebar`. L'unione è `string` e non un enum
/// chiuso perché le view si scoprono a runtime, e chiuderle qui vorrebbe
/// dire cablare gli id che il piano vieta.
export type SidebarPanel = "files" | "search" | (string & {});

/// I due pannelli nativi della shell, che ci sono sempre.
const NATIVE_PANELS: Record<"files" | "search", HTMLElement> = {
  files: $("#files-panel"),
  search: $("#search-panel"),
};

/// Mostra un pannello della sidebar, nascondendo tutti gli altri.
///
/// Per i due nativi (`files`, `search`) nasconde l'altro e tutte le view
/// dichiarate in `#views-left`. Per una view dichiarata (id qualunque)
/// nasconde i due nativi e tutte le altre view dichiarate tranne quella.
/// Default `files`: se l'id non è nessuno dei due nativi e non corrisponde
/// a una view montata, si torna ai file — è il pannello che c'è sempre.
export function showPanel(panel: SidebarPanel): void {
  const viewsLeft = $("#views-left");
  // I due nativi si escludono a vicenda e con le view.
  NATIVE_PANELS.files.hidden = panel !== "files";
  NATIVE_PANELS.search.hidden = panel !== "search";
  // Le view dichiarate: una sola visibile, le altre `hidden` (non
  // `collapsed`: quello nasconde il corpo e lascia il titolo, e in una
  // sidebar a rail i titoli impilati sono rumore).
  for (const viewPanel of viewsLeft.querySelectorAll<HTMLElement>(
    ".declared-view-panel",
  )) {
    const on = viewPanel.dataset.viewId === panel;
    viewPanel.hidden = !on;
    // Aprire un pannello dalla rail vuol dire mostrarne il contenuto **e**
    // dirlo: finché erano due scritture — una classe per la pelle, un
    // `aria-expanded` per chi ascolta — questa riga aggiornava solo la prima,
    // e il titolo continuava ad annunciare «chiuso» sopra un pannello aperto.
    if (on) {
      const content = viewPanel.querySelector<HTMLElement>(":scope > .declared-view");
      if (content) content.hidden = false;
      const title = viewPanel.querySelector<HTMLElement>(":scope > .panel-title");
      if (title?.hasAttribute("aria-expanded")) title.setAttribute("aria-expanded", "true");
    }
  }
  // La rail riflette chi è acceso. Sta qui e non nei click dei bottoni
  // perché anche il menu Vista e il comando da tastiera devono aggiornare
  // `aria-pressed`, e duplicare la regola in tre posti è il modo in cui
  // resta indietro.
  const ribbon = document.getElementById("views-ribbon");
  if (ribbon) {
    for (const btn of ribbon.querySelectorAll<HTMLButtonElement>(".rail-btn")) {
      // Il grafo è un linguetta nell'area principale, non un pannello della
      // sidebar: `showPanel` non lo spegne e non lo accende.
      if (btn.id === "show-graph") continue;
      btn.setAttribute("aria-pressed", String(btn.dataset.panel === panel));
    }
  }
}

/// Il pannello nativo è visibile? Le view dichiarate non si chiedono qui.
export function isPanelVisible(panel: "files" | "search"): boolean {
  return !NATIVE_PANELS[panel].hidden;
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