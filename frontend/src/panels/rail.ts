// La rail: la colonna di icone a sinistra, sempre visibile.
//
// Sostituisce la ribbon di prima, che era una barra orizzontale che
// compariva solo quando una view la dichiarava. La rail è verticale, è
// sempre lì, e porta le tre icone shell — Note, Cerca, Grafo — prima di
// quelle che le view dichiarate con `left_sidebar` appendono dopo.
//
// # Perché le icone shell sono qui e non in views.ts
//
// `views.ts` scopre le view dal backend e le monta: non sa cosa sia una
// nota né una ricerca, e non le cablia. La rail invece è **della shell**: i
// suoi tre bottoni sono la scorciatoia per i tre pannelli che la shell ha
// sempre avuto. Quindi le icone shell le monta questo modulo, e `views.ts`
// appende le proprie dopo, nello stesso contenitore `#views-ribbon`.
//
// # syncRail
//
// Le view dichiarate si scoprono dopo l'apertura del vault
// (`mountDeclaredViews`), e la rail deve rifletterle. `main.ts` chiama
// `syncRail()` in coda all'apertura, dopo che `mountDeclaredViews` ha
// riempito `#views-left`: la rail legge cosa c'è e aggiunge i bottoni.
import { $ } from "../ui/dom";
import { iconEl } from "../ui/icons";
import { showPanel } from "./sidebar";
import { t, onLanguage } from "../i18n/strings";
import type { Teardown } from "../ui/lifetime";

/// Le tre icone shell, nell'ordine canonico. Il grafo è uno di loro, e
// conserva il suo id `#show-graph` — `mountGraph` ascolta quell'id, e non
// va toccato.
const SHELL = [
  { id: "files", icon: "notes", label: "rail.notes", hint: "rail.notes.hint" },
  { id: "search", icon: "search", label: "rail.search", hint: "rail.search.hint" },
] as const;

/// Monta la rail: le icone shell in `#rail-shell`, dentro `#views-ribbon`.
/// Le view dichiarate si aggiungono dopo con `syncRail`.
export function mountRail(): Teardown {
  const shell = $("#rail-shell");
  // Pulisce: il rimontaggio (un vault che si riapre) non deve accumulare.
  shell.replaceChildren();

  for (const entry of SHELL) {
    const btn = createRailButton(entry.icon, entry.label, entry.hint);
    btn.dataset.panel = entry.id;
    btn.setAttribute("aria-pressed", String(entry.id === "files"));
    btn.addEventListener("click", () => showPanel(entry.id));
    shell.append(btn);
  }

  // Il grafo è un bottone shell ma conserva il suo id storico: `mountGraph`
  // ascolta `#show-graph`, e l'handler è di là. Qui lo creiamo con quell'id
  // e non attacchiamo un listener nostro — il suo click lo gestisce `graph.ts`.
  const graph = createRailButton("graph", "rail.graph", "rail.graph.hint");
  graph.id = "show-graph";
  shell.append(graph);

  // I label della rail seguono la lingua. Si iscrivono qui e si smontano
  // col ritorno.
  return onLanguage(() => updateLabel());
}

/// Aggiorna i label dei bottoni rail quando la lingua cambia.
function updateLabel(): void {
  const shell = $("#rail-shell");
  for (const btn of shell.querySelectorAll<HTMLButtonElement>(".rail-btn")) {
    const key = btn.dataset.label;
    const hint = btn.dataset.hint;
    if (key) btn.setAttribute("title", t(key as never));
    if (hint) btn.setAttribute("aria-label", t(hint as never));
  }
}

/// Riscopre le view `left_sidebar` montate in `#views-left` e aggiunge un
/// bottone rail per ciascuna. Da chiamare dopo `mountDeclaredViews`.
///
/// Non cabla id di feature: legge il DOM di `#views-left`, che
/// `mountDeclaredViews` riempie con i pannelli delle view dichiarate. Ogni
/// pannello ha `data-view-id` e un titolo; la rail ne fa un bottone icona.
export function syncRail(): void {
  const ribbon = $("#views-ribbon");
  // Rimuove i bottoni delle view dichiarate di un eventuale giro precedente:
  // le icone shell (dentro `#rail-shell`) non si toccano.
  for (const old of ribbon.querySelectorAll(".rail-btn-view")) {
    old.remove();
  }
  const viewsLeft = $("#views-left");
  for (const panel of viewsLeft.querySelectorAll<HTMLElement>(
    ".declared-view-panel",
  )) {
    const viewId = panel.dataset.viewId;
    if (!viewId) continue;
    const title = panel.querySelector<HTMLElement>(".panel-title");
    const name = title?.textContent ?? viewId;
    const icon = title?.dataset.icon ?? "outline";
    const btn = createRailButton(icon, "rail.notes", "rail.notes.hint");
    btn.classList.add("rail-btn-view");
    btn.dataset.panel = viewId;
    btn.dataset.label = name;
    btn.dataset.hint = name;
    btn.setAttribute("title", name);
    btn.setAttribute("aria-label", name);
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => showPanel(viewId));
    ribbon.append(btn);
  }
  // Una sola superficie a sinistra: i file. Le view dichiarate restano
  // raggiungibili dalla rail, nascoste finché non le si chiede.
  showPanel("files");
}

/// Crea un bottone rail: icona + aria-label + title, classe `.rail-btn`.
function createRailButton(
  icon: string,
  label: string,
  hint: string,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rail-btn";
  btn.dataset.label = label;
  btn.dataset.hint = hint;
  btn.setAttribute("title", t(label as never));
  btn.setAttribute("aria-label", t(hint as never));
  const svg = iconEl(icon) ?? iconEl("outline");
  if (svg) btn.append(svg);
  return btn;
}