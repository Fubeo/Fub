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
import { lastShownPanel, showPanel } from "./sidebar";
import { t, onLanguage } from "../i18n/strings";
import type { Teardown } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";
import { showContextMenu } from "../ui/menu";
import type { ShellGeometry } from "../state/shell-geometry";
import { settings } from "../host/query";
import { api } from "../host/ipc";
import { notify } from "../ui/notify";
import type { SettingEntry } from "../host/contract";
import { onEvent } from "../state/kernel";

const CHROME_VERSION = "chrome.schema";
const RAIL_VISIBLE = "chrome.rail.visible";
const RAIL_ORDER = "chrome.rail.order";
let geometryOrder: string[] | null = null;
let chromeOrder: string[] = [];
let chromeVisible = true;

/** Machine chrome settings are versioned. Unknown future versions do not
 * silently apply potentially incompatible layout values. */
export function applyRailMachineSettings(entries: readonly SettingEntry[]): void {
  const values = new Map(entries.map((entry) => [entry.spec.key, entry.value]));
  if (values.get(CHROME_VERSION) !== 1) {
    chromeVisible = true;
    chromeOrder = [];
  } else {
    chromeVisible = values.get(RAIL_VISIBLE) !== false;
    const ordered = values.get(RAIL_ORDER);
    chromeOrder = Array.isArray(ordered) && ordered.every((value) => typeof value === "string")
      ? [...new Set(ordered)] : [];
  }
  const ribbon = document.getElementById("views-ribbon");
  if (ribbon) {
    ribbon.hidden = !chromeVisible;
    if (!geometryOrder) order = [...chromeOrder];
    arrangeRail();
  }
}

const RAIL_KEY = "fub.shell.rail.v1";
let order: string[] = [];
let hiddenPanels: string[] = [];
try {
  const raw = JSON.parse(localStorage.getItem(RAIL_KEY) ?? "null") as unknown;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const config = raw as Record<string, unknown>;
    if (Array.isArray(config.order) && config.order.every((v) => typeof v === "string")) order = config.order;
    if (Array.isArray(config.hidden) && config.hidden.every((v) => typeof v === "string")) hiddenPanels = config.hidden;
  }
} catch { /* An unavailable/invalid machine preference is not a vault failure. */ }

function persistRail(): void {
  try { localStorage.setItem(RAIL_KEY, JSON.stringify({ order, hidden: hiddenPanels })); } catch { /* read-only machine */ }
}

function railButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("#views-ribbon .rail-btn[data-panel]")];
}

function arrangeRail(): void {
  const ribbon = $("#views-ribbon");
  const buttons = railButtons();
  order = [...order, ...buttons.map((button) => button.dataset.panel!).filter((id) => !order.includes(id))];
  buttons.sort((a, b) => order.indexOf(a.dataset.panel!) - order.indexOf(b.dataset.panel!));
  for (const button of buttons) {
    button.hidden = hiddenPanels.includes(button.dataset.panel!);
    ribbon.append(button);
  }
}

export function configureRail(geometry: ShellGeometry): void {
  geometryOrder = geometry.railOrder ? [...geometry.railOrder] : null;
  order = geometryOrder ? [...geometryOrder] : [...chromeOrder];
  if (geometry.hiddenPanels) hiddenPanels = [...geometry.hiddenPanels];
  arrangeRail();
  persistRail();
}

function manageRail(at: MouseEvent, selected?: string): void {
  const buttons = railButtons();
  const names = buttons.map((button) => button.getAttribute("aria-label") ?? button.dataset.panel!);
  showContextMenu(at, buttons.flatMap((button, index) => {
    const id = button.dataset.panel!;
    const name = names[index]!;
    return [
      { label: t(button.hidden ? "rail.show" : "rail.hide", { name }), run: () => {
        hiddenPanels = button.hidden ? hiddenPanels.filter((value) => value !== id) : [...hiddenPanels, id];
        arrangeRail();
        persistRail();
      } },
      ...(index > 0 ? [{ label: t("rail.move_up", { name }), run: () => shiftRail(id, -1) }] : []),
      ...(index < buttons.length - 1 ? [{ label: t("rail.move_down", { name }), run: () => shiftRail(id, 1) }] : []),
    ];
  }), { labelledBy: selected });
}

function shiftRail(id: string, delta: number): void {
  const at = order.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= order.length) return;
  const previous = [...order];
  [order[at], order[to]] = [order[to]!, order[at]!];
  geometryOrder = [...order];
  arrangeRail();
  persistRail();
  void api.setSetting(RAIL_ORDER, [...order]).catch((error: unknown) => {
    order = previous;
    geometryOrder = [...previous];
    arrangeRail();
    persistRail();
    notify(t("rail.order_failed", { reason: String(error) }), "guasto");
  });
  railButtons().find((button) => button.dataset.panel === id)?.focus();
}

function wireConfiguration(button: HTMLButtonElement): void {
  button.addEventListener("keydown", (event) => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      shiftRail(button.dataset.panel!, event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
      event.preventDefault();
      manageRail(new MouseEvent("contextmenu", {
        clientX: button.getBoundingClientRect().left, clientY: button.getBoundingClientRect().bottom,
      }), button.id || undefined);
    }
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    manageRail(event, button.id || undefined);
  });
}

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
  let disposed = false;
  const readChrome = async () => {
    try {
      const entries = await settings();
      if (!disposed) applyRailMachineSettings(entries);
    } catch {
      // A machine configuration without a vault may not yet be available.
    }
  };
  const offSetting = onEvent("setting_changed", (event) => {
    if (event.key === CHROME_VERSION || event.key === RAIL_VISIBLE || event.key === RAIL_ORDER) {
      void readChrome();
    }
  });
  void readChrome();
  // Pulisce: il rimontaggio (un vault che si riapre) non deve accumulare.
  shell.replaceChildren();
  $("#views-ribbon").querySelectorAll(".rail-btn:not(.rail-btn-view)").forEach((button) => button.remove());

  for (const entry of SHELL) {
    const btn = createRailButton(entry.icon, entry.label, entry.hint);
    btn.dataset.panel = entry.id;
    btn.setAttribute("aria-pressed", String(entry.id === "files"));
    btn.addEventListener("click", () => showPanel(entry.id));
    wireConfiguration(btn);
    shell.append(btn);
  }

  // Il grafo è un bottone shell ma conserva il suo id storico: `mountGraph`
  // ascolta `#show-graph`, e l'handler è di là. Qui lo creiamo con quell'id
  // e non attacchiamo un listener nostro — il suo click lo gestisce `graph.ts`.
  const graph = createRailButton("graph", "rail.graph", "rail.graph.hint");
  graph.id = "show-graph";
  shell.append(graph);
  graph.dataset.panel = "graph";
  wireConfiguration(graph);

  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "rail-btn";
  manage.textContent = "⋯";
  manage.setAttribute("aria-label", t("rail.manage"));
  manage.addEventListener("click", (event) => manageRail(event));
  shell.append(manage);
  arrangeRail();
  // I label della rail seguono la lingua. Si iscrivono qui e si smontano
  // col ritorno.
  const offLanguage = onLanguage(() => updateLabel());
  return () => {
    disposed = true;
    offSetting();
    offLanguage();
  };
}

/// Aggiorna i label dei bottoni rail quando la lingua cambia.
function updateLabel(): void {
  const shell = $("#views-ribbon");
  for (const btn of shell.querySelectorAll<HTMLButtonElement>(".rail-btn")) {
    const key = btn.dataset.label;
    const hint = btn.dataset.hint;
    if (key) setTooltip(btn, t(key as never));
    if (hint) btn.setAttribute("aria-label", t(hint as never));
  }
  const manage = document.querySelector<HTMLButtonElement>("#rail-shell .rail-btn:not([data-panel])");
  if (manage) manage.setAttribute("aria-label", t("rail.manage"));
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
    setTooltip(btn, name);
    btn.setAttribute("aria-label", name);
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => showPanel(viewId));
    ribbon.append(btn);
    wireConfiguration(btn);
  }
  // R07: una view ancora valida sopravvive a refresh/cambio vault — si
  // rimostra l'ultimo pannello chiesto se esiste ancora, i file altrimenti.
  // Mai un azzeramento arbitrario: se l'utente stava su una view dichiarata
  // rimossa, `showPanel` ricade sui file da sé.
  showPanel(lastShownPanel());
  arrangeRail();
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
  setTooltip(btn, t(label as never));
  btn.setAttribute("aria-label", t(hint as never));
  const svg = iconEl(icon) ?? iconEl("outline");
  if (svg) btn.append(svg);
  return btn;
}