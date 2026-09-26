// La rail: la colonna di icone a sinistra, sempre visibile.
//
// Sostituisce la ribbon di prima, che era una barra orizzontale che
// compariva solo quando una view la dichiarava. La rail è verticale, è
// sempre lì, e porta le due icone shell — Note, Cerca — prima di quelle
// delle view dichiarate: le view principali che si aprono senza argomenti,
// e le view `left_sidebar`.
//
// # Perché le icone shell sono qui e non in views.ts
//
// `views.ts` scopre le view dal backend e le monta: non sa cosa sia una
// nota né una ricerca, e non le cablia. La rail invece è **della shell**: i
// suoi due bottoni sono la scorciatoia per i due pannelli che la shell ha
// sempre avuto. Quindi le icone shell le monta questo modulo, e `views.ts`
// appende le proprie dopo, nello stesso contenitore `#views-ribbon`.
//
// Una view non ha un posto riservato qui: il grafo è una view principale
// come le altre, e la sua icona c'è finché il suo componente la dichiara.
//
// # syncRail
//
// Le view dichiarate si scoprono dopo l'apertura del vault
// (`mountDeclaredViews`), e la rail deve rifletterle. `main.ts` chiama
// `syncRail()` in coda all'apertura, dopo che `mountDeclaredViews` ha
// riempito `#views-left` e l'elenco delle view principali: la rail legge
// cosa c'è e aggiunge i bottoni.
import { $ } from "../ui/dom";
import { iconEl } from "../ui/icons";
import { lastShownPanel, showPanel } from "./sidebar";
import { t, onLanguage } from "../i18n/strings";
import type { Teardown } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";
import { showContextMenu } from "../ui/menu";
import type { ShellGeometry } from "../state/shell-geometry";
import { settings } from "../host/query";
import { adoptLegacyChrome, writeChrome } from "../state/machine-chrome";
import { errorText } from "../host/errors";
import { Race } from "../ui/race";
import { notify } from "../ui/notify";
import type { SettingEntry } from "../host/contract";
import { onEvent } from "../state/kernel";
import { revealSidePanel, sidePanelVisible, toggleSidePanel } from "../ui/side-panels";
import { allCommands, ariaBinding, displayBinding } from "../ui/commands";
import { openPrimaryView, opensWithoutParams, primaryViews } from "../ui/primary-views";

/// Il comando che ogni icona shell esegue, per scriverne l'accordo nel
/// suggerimento.
const RAIL_COMMANDS: Record<string, string> = {
  files: "shell.panel.files",
  search: "shell.panel.search",
};

/// Il clic su un'icona della rail: mostra il pannello, e se è già quello
/// davanti chiude la barra — come in ogni editor con una barra di attività.
function railClick(panel: string): void {
  if (sidePanelVisible("sidebar") && lastShownPanel() === panel) {
    toggleSidePanel("sidebar");
    return;
  }
  revealSidePanel("sidebar");
  showPanel(panel);
}

const CHROME_VERSION = "chrome.schema";
const RAIL_VISIBLE = "chrome.rail.visible";
const RAIL_ORDER = "chrome.rail.order";
const RAIL_HIDDEN = "chrome.rail.hidden";
/// Dove stavano ordine e icone nascoste prima di `chrome.*`: si legge una
/// volta sola, per adottarne le icone nascoste (`state/machine-chrome.ts`).
const LEGACY_RAIL = "fub.shell.rail.v1";
/// Ordine e icone nascoste di un workspace applicato: valgono per la sessione
/// sopra le impostazioni della macchina, che restano la base.
let geometryOrder: string[] | null = null;
let geometryHidden: string[] | null = null;
let chromeOrder: string[] = [];
let chromeHidden: string[] = [];
let chromeVisible = true;
let order: string[] = [];
let hiddenPanels: string[] = [];

function stringList(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...new Set(value)] : [];
}

/// Le icone nascoste della chiave di prima; `null` se non ce n'erano.
function legacyHidden(raw: string): string[] | null {
  const config = JSON.parse(raw) as unknown;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const hidden = stringList((config as Record<string, unknown>).hidden);
  return hidden.length > 0 ? hidden : null;
}

/** Machine chrome settings are versioned. Unknown future versions do not
 * silently apply potentially incompatible layout values. */
export function applyRailMachineSettings(entries: readonly SettingEntry[]): void {
  const values = new Map(entries.map((entry) => [entry.spec.key, entry.value]));
  if (values.get(CHROME_VERSION) !== 1) {
    chromeVisible = true;
    chromeOrder = [];
    chromeHidden = [];
  } else {
    chromeVisible = values.get(RAIL_VISIBLE) !== false;
    chromeOrder = stringList(values.get(RAIL_ORDER));
    chromeHidden = stringList(values.get(RAIL_HIDDEN));
  }
  const ribbon = document.getElementById("views-ribbon");
  if (ribbon) {
    ribbon.hidden = !chromeVisible;
    if (!geometryOrder) order = [...chromeOrder];
    if (!geometryHidden) hiddenPanels = [...chromeHidden];
    arrangeRail();
  }
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
  // «Configura» sta in fondo, dopo le icone che configura.
  const manage = ribbon.querySelector<HTMLButtonElement>(".rail-btn-manage");
  if (manage) ribbon.append(manage);
}

export function configureRail(geometry: ShellGeometry): void {
  geometryOrder = geometry.railOrder ? [...geometry.railOrder] : null;
  order = geometryOrder ? [...geometryOrder] : [...chromeOrder];
  geometryHidden = geometry.hiddenPanels ? [...geometry.hiddenPanels] : null;
  hiddenPanels = geometryHidden ? [...geometryHidden] : [...chromeHidden];
  arrangeRail();
}

/// Nasconde o mostra icone, e lo ricorda sulla macchina come l'ordine.
function setHiddenPanels(next: string[]): void {
  const previous = [...hiddenPanels];
  hiddenPanels = next;
  geometryHidden = [...next];
  arrangeRail();
  void writeChrome(RAIL_HIDDEN, [...next]).catch((error: unknown) => {
    hiddenPanels = previous;
    geometryHidden = [...previous];
    arrangeRail();
    notify(t("rail.hidden_failed", { reason: errorText(error) }), "guasto");
  });
}

function manageRail(at: MouseEvent, selected?: string): void {
  const buttons = railButtons();
  const names = buttons.map((button) => button.getAttribute("aria-label") ?? button.dataset.panel!);
  showContextMenu(at, buttons.flatMap((button, index) => {
    const id = button.dataset.panel!;
    const name = names[index]!;
    return [
      { separator: index > 0, label: t(button.hidden ? "rail.show" : "rail.hide", { name }), run: () => {
        setHiddenPanels(button.hidden ? hiddenPanels.filter((value) => value !== id) : [...hiddenPanels, id]);
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
  void writeChrome(RAIL_ORDER, [...order]).catch((error: unknown) => {
    order = previous;
    geometryOrder = [...previous];
    arrangeRail();
    notify(t("rail.order_failed", { reason: errorText(error) }), "guasto");
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

/// Le due icone shell, nell'ordine canonico.
const SHELL = [
  { id: "files", icon: "notes", label: "rail.notes", hint: "rail.notes.hint" },
  { id: "search", icon: "search", label: "rail.search", hint: "rail.search.hint" },
] as const;

/// Monta la rail: le icone shell in `#rail-shell`, dentro `#views-ribbon`.
/// Le view dichiarate si aggiungono dopo con `syncRail`.
export function mountRail(): Teardown {
  const shell = $("#rail-shell");
  let disposed = false;
  const reads = new Race();
  const readChrome = () => reads.last(async (expected) => {
    // A machine configuration without a vault may not yet be available.
    let entries = await expected(settings().catch(() => null));
    if (!entries) return;
    const hidden = await expected(adoptLegacyChrome(
      LEGACY_RAIL,
      entries.find((entry) => entry.spec.key === RAIL_HIDDEN),
      legacyHidden,
    ));
    if (hidden) entries = entries.map((entry) => entry.spec.key === RAIL_HIDDEN ? { ...entry, value: hidden } : entry);
    if (!disposed) applyRailMachineSettings(entries);
  });
  const offSetting = onEvent("setting_changed", (event) => {
    if (event.key === CHROME_VERSION || event.key === RAIL_VISIBLE || event.key === RAIL_ORDER
      || event.key === RAIL_HIDDEN) {
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
    btn.addEventListener("click", () => railClick(entry.id));
    wireConfiguration(btn);
    shell.append(btn);
  }

  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "rail-btn rail-btn-manage";
  manage.textContent = "⋯";
  manage.setAttribute("aria-label", t("rail.manage"));
  setTooltip(manage, t("rail.manage"));
  manage.addEventListener("click", (event) => manageRail(event));
  shell.append(manage);
  arrangeRail();
  updateLabel();
  // I label della rail seguono la lingua. Si iscrivono qui e si smontano
  // col ritorno.
  const offLanguage = onLanguage(() => updateLabel());
  return () => {
    disposed = true;
    reads.cancel();
    offSetting();
    offLanguage();
  };
}

/// Aggiorna i label dei bottoni rail quando la lingua cambia.
function updateLabel(): void {
  const shell = $("#views-ribbon");
  for (const btn of shell.querySelectorAll<HTMLButtonElement>(".rail-btn:not(.rail-btn-view)")) {
    // Il nome accessibile è la frase («Il grafo dei collegamenti»), come prima:
    // l'icona non ha testo, e la parola sola dice meno di ciò che il bottone fa.
    const key = btn.dataset.hint ?? btn.dataset.label;
    if (key) labelRailButton(btn, t(key as never), btn.dataset.panel);
  }
  const manage = document.querySelector<HTMLButtonElement>("#views-ribbon .rail-btn-manage");
  if (manage) {
    manage.setAttribute("aria-label", t("rail.manage"));
    setTooltip(manage, t("rail.manage"));
  }
}

/// Nome e suggerimento di un'icona sono la stessa frase («Il grafo dei
/// collegamenti»), e il suggerimento aggiunge la scorciatoia che fa la stessa
/// cosa.
export function labelRailButton(btn: HTMLElement, name: string, panel?: string): void {
  btn.setAttribute("aria-label", name);
  const id = panel ? RAIL_COMMANDS[panel] : undefined;
  const binding = id ? allCommands().find((entry) => entry.id === id)?.binding ?? null : null;
  const chord = displayBinding(binding);
  setTooltip(btn, chord ? `${name} (${chord})` : name);
  // Il suggerimento si legge (`⌘⇧E`), l'attributo si annuncia (`Meta+Shift+E`).
  const aria = ariaBinding(binding);
  if (aria) btn.setAttribute("aria-keyshortcuts", aria);
  else btn.removeAttribute("aria-keyshortcuts");
}

/// Riscrive i suggerimenti quando le scorciatoie cambiano.
export function refreshRailShortcuts(): void {
  updateLabel();
}

/// Riscopre le view dichiarate e aggiunge un bottone rail per ciascuna: prima
/// le view principali che si aprono senza argomenti, poi le view
/// `left_sidebar` montate in `#views-left`. Da chiamare dopo
/// `mountDeclaredViews`.
///
/// Non cabla id di feature: le view principali le legge dall'elenco che
/// `mountDeclaredViews` scrive, quelle di barra dal DOM di `#views-left`, che
/// riempie con i loro pannelli. Ogni pannello ha `data-view-id` e un titolo;
/// la rail ne fa un bottone icona.
export function syncRail(): void {
  const ribbon = $("#views-ribbon");
  // Rimuove i bottoni delle view dichiarate di un eventuale giro precedente:
  // le icone shell (dentro `#rail-shell`) non si toccano.
  for (const old of ribbon.querySelectorAll(".rail-btn-view")) {
    old.remove();
  }
  // Una view principale non è un pannello della barra: il clic la apre nel
  // riquadro col fuoco, come la palette e un `OpenView`, e il bottone non ha
  // uno stato «premuto» — la linguetta è nel riquadro, non qui.
  for (const spec of primaryViews()) {
    if (!opensWithoutParams(spec)) continue;
    const btn = createRailButton(spec.icon ?? "outline", "rail.notes", "rail.notes.hint");
    btn.classList.add("rail-btn-view", "rail-btn-main");
    btn.dataset.panel = spec.id;
    btn.dataset.label = spec.title;
    btn.dataset.hint = spec.title;
    labelRailButton(btn, spec.title);
    btn.addEventListener("click", () => openPrimaryView(spec.id));
    ribbon.append(btn);
    wireConfiguration(btn);
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
    btn.addEventListener("click", () => railClick(viewId));
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
  labelRailButton(btn, t(hint as never));
  const svg = iconEl(icon) ?? iconEl("outline");
  if (svg) btn.append(svg);
  return btn;
}