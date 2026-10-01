// **Il pannello delle impostazioni** (§11.1): il posto che questa shell non
// aveva, e che `ui/views.ts` dichiarava mancante da tre sedute
// («questa shell non ha ancora un pannello di impostazioni (§11.1)»).
//
// # Il form lo genera la shell, e lo schema lo dichiara chi lo possiede
//
// Nessun id cablato qui dentro: si chiede al canale dati com'è configurato
// questo vault (`impostazioni()`, `IndexQuery::Settings`) e si disegna ciò che
// torna — chiave, etichetta, prosa, gruppo, specie e sourceLabel. Un'impostazione
// di un plugin comparirà da sola, come una view dichiarata, e senza che il
// plugin scriva una riga di UI.
//
// È la stessa divisione delle view (decisione 0016) applicata alla
// configurazione, e va nell'altro verso: là il provider manda un albero e la
// shell lo disegna, qui il provider dichiara uno **schema** e la shell disegna i
// campi. La ragione è che di uno schema hanno bisogno in tre — questo pannello,
// una CLI (27.1) e un centro di comando (22.4) — e un albero `UiNode` sarebbe
// la UI di uno solo.
//
// # Come si rappresenta, e come si legge
//
// Quale controllo, con che passo, cosa dire del predefinito e cosa trova una
// ricerca lo decide `settings-model.ts`, senza DOM: il controllo nasce dalla
// forma del dato e non dalla chiave. Qui si disegna: una finestra con le schede
// a sinistra e, sotto, l'indice delle sezioni della scheda; in alto la ricerca,
// che non ridisegna ma nasconde; al centro un gruppo per sezione, le righe in
// una scheda. Scorre solo il corpo, così la chiusura e la scheda corrente
// restano sempre in vista.
//
// # Perché di qui si può cambiare tutto
//
// `SettingSpec.program_writable` non riguarda questo pannello: da qui passa la
// **persona davanti allo schermo**, e la scrittura va a `api.setSetting`, che è
// il comando IPC dell'utente. Quel flag riguarda `settings.set`, i plugin e le
// macro — il residuo della decisione 0010, chiuso per chiave. Se fossero la
// stessa strada, o l'utente non potrebbe cambiare le proprie impostazioni di
// privacy, o un plugin potrebbe.
import { api } from "../host/ipc";
import { confirm, pickFile, pickFolder } from "../host/dialog";
import { Race } from "../ui/race";
import { settings } from "../host/query";
import type {
  BundleInfo,
  InstalledPluginInfo,
  CatalogEntry,
  SettingEntry,
  SettingValue,
  ThemeInfo,
  SettingScope,
  KnownVault,
  UiOption,
} from "../host/contract";
import { onEvent } from "../state/kernel";
import { state } from "../state/store";
import { $ } from "../ui/dom";
import { trapFocus } from "../ui/a11y";
import { notify } from "../ui/notify";
import { allCommands, keybindingIssues, keybindingKey, validateKeybinding, type CommandEntry } from "../ui/commands";
import { TRUST_LABELS, isPermissionKey, rows, type PermissionRow } from "../ui/permissions";
import { SETTINGS_WITH_THEIR_OWN_GESTURE } from "../ui/shell-ids.generated";
import { errorText } from "../host/errors";
import { LANGUAGE_KEY, catalogLanguages, onLanguage, plural, t, type Key } from "../i18n/strings";
import {
  SERIES_THEME_ID,
  THEME_KEY,
  cancelThemePreview,
  currentThemeId,
  currentThemePreview,
  previewTheme,
  selectTheme,
  themeCatalog,
} from "../theme/theme";
import { setTooltip } from "../ui/tooltip";
import { enterSurface, exitSurface } from "../ui/motion";
import { icon } from "../ui/icons";
import { reducedMotion } from "../theme/reduced-motion";
import {
  CSS_SNIPPETS_KEY, DEFAULT_CSS_SNIPPETS, cancelCssSnippetsPreview,
  cssSnippetCatalog, disableCssSnippet, parseCssSnippets, previewCssSnippets,
  saveCssSnippets,
} from "../theme/snippets";
import { openLifetime, type Lifetime, type Teardown } from "../ui/lifetime";
import {
  controlFor,
  defaultText,
  isModified,
  matchesTerms,
  normalizeSearch,
  optionLabel,
  searchTerms,
  searchText,
  sectionAnchor,
  show,
  type Control,
} from "./settings-model";

/// Le righe risolte per chiave: è ciò con cui una scheda ritrova il valore di
/// una chiave che ha composto invece di leggerla da un elenco.
type EntryMap = Map<string, SettingEntry>;

/// Un gruppo del form: l'intestazione e le sue righe, nell'ordine in cui il
/// canale dati le ha date (che è l'ordine in cui sono state dichiarate).
export interface Group {
  title: string;
  rows: SettingEntry[];
}

/// Le righe raggruppate come le disegna il pannello.
///
/// È una funzione pura e sta qui in cima perché è **la sola regola** di questo
/// modulo — il resto è DOM. I gruppi escono nell'ordine di prima apparizione e
/// non in ordine alfabetico: chi dichiara le proprie impostazioni le scrive
/// nell'ordine in cui vanno lette, e riordinarle vorrebbe dire mettere
/// «Avanzate» prima di «Generali» perché comincia per A. Le righe senza gruppo
/// vanno **in fondo**, sotto un'intestazione loro: in mezzo, sembrerebbero del
/// gruppo precedente.
export function groupEntries(entries: SettingEntry[]): Group[] {
  const groups: Group[] = [];
  const others: SettingEntry[] = [];
  for (const entry of entries) {
    if (entry.spec.group === "") {
      others.push(entry);
      continue;
    }
    const existing = groups.find((g) => g.title === entry.spec.group);
    if (existing) existing.rows.push(entry);
    else groups.push({ title: entry.spec.group, rows: [entry] });
  }
  if (others.length > 0) groups.push({ title: t("settings.group.other"), rows: others });
  return groups;
}

/// Cosa dire sotto una riga a proposito di **dove** vive il suo valore.
///
/// È l'informazione che un utente non ha modo di dedurre e che decide se quel
/// che sta per cambiare viaggerà col vault: senza, un'impostazione di macchina e
/// una del vault si toccano allo stesso modo e si comportano diversamente su
/// un'altra macchina. A schermo la dice una pastiglia breve; questa frase intera
/// è ciò che il lettore di schermo sente arrivando sul campo.
export function sourceLabel(entry: SettingEntry): string {
  const where = t(entry.spec.scope === "machine" ? "settings.scope.machine" : "settings.scope.vault");
  switch (entry.source) {
    case "default":
      return t("settings.source.default", { "dove": where });
    case "machine":
      return t("settings.source.machine");
    case "vault":
      return t("settings.source.vault");
  }
}

/// Gli elementi, presi **al montaggio** e non all'import: un modulo che tocca
/// il DOM appena viene importato è un modulo che non si può provare senza una
/// pagina, ed è la ragione per cui le due regole di qui sopra stanno in cima e
/// pure.
let panelEl: HTMLElement;
let bodyEl: HTMLElement;
let tabsEl: HTMLElement;
/// Chi scorre: il contenitore del corpo nella scocca vera, il corpo stesso in
/// una scocca ridotta (i banchi dei test montano solo schede e corpo).
let scrollEl: HTMLElement;
/// Barra di ricerca e indice: facoltativi per la stessa ragione. Una scocca che
/// non li ha resta un pannello che funziona, senza ricerca né indice.
let toolbarEl: HTMLElement | null = null;
let searchEl: HTMLInputElement | null = null;
let modifiedEl: HTMLButtonElement | null = null;
let countEl: HTMLElement | null = null;
let tocEl: HTMLElement | null = null;
let tocListEl: HTMLElement | null = null;

function optional<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/// Le due cose che questo pannello sa **far fare al resto della shell**, e che
/// non sa fare da sé.
///
/// Sono passate e non importate perché la strada giusta esiste già e sta in
/// `main.ts`: aprire un vault è una dozzina di passi in ordine, e rifarli qui
/// sarebbe una seconda idea di cosa vuol dire aprire. Importarli darebbe un
/// ciclo (`main` monta questo pannello), quindi arrivano dal montaggio.
export interface Hooks {
  /// Apre un vault e ricostruisce la shell attorno, come farebbe il selettore
  /// di cartella.
  openVault(root: string): Promise<void>;
  /// Riscopre view e comandi. Serve dopo aver acceso o spento un componente:
  /// `set_plugin_enabled` monta e smonta **subito** lato host, ma la scoperta
  /// gira solo all'apertura del vault — senza questa chiamata le view di un
  /// plugin spento resterebbero appese nella sidebar, e quelle di uno appena
  /// acceso non comparirebbero fino al riavvio.
  reloadProvider(): Promise<void>;
}

let settingsHooks: Hooks;

/// Le schede che questo pannello ospita. `views` è la superficie
/// `settings_tab` del contratto (§2.2): la dichiarano le view, e finora questa
/// shell non aveva dove metterle.
type SettingsTab = "settings" | "components" | "shortcuts" | "vault";

/// La figura di ogni scheda nella colonna di navigazione.
const TAB_ICONS: Record<SettingsTab, string> = {
  settings: "settings",
  components: "component",
  shortcuts: "keyboard",
  vault: "vault",
};

let tab: SettingsTab = "settings";

/// La scheda dell'ultimo disegno: cambiarla riporta lo scroll in cima, un
/// ridisegno della stessa lo conserva.
let renderedTab: SettingsTab | null = null;

const settingsTabsId = "settings-body";

function tabButtons(): HTMLButtonElement[] {
  return [...tabsEl.querySelectorAll<HTMLButtonElement>("button[data-tab]")];
}

/// La scheda successiva per un tasto. Le schede stanno in colonna, quindi su e
/// giù sono le frecce che si provano per prime; destra e sinistra restano per
/// chi le usa da una fila (la finestra stretta le dispone così).
function moveTab(current: number, key: string, count: number): number | null {
  if (count < 1) return null;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/// Un radiogroup è una sola fermata nel Tab: la selezione corrente resta
/// tabbabile, mentre le frecce spostano sia il fuoco sia il valore. La
/// sincronizzazione è ottimistica (prima della scrittura asincrona), e il
/// successivo render rilegge il valore autorevole dal kernel.
///
/// Un'opzione disabilitata (una cornice che il sistema non offre) non si
/// raggiunge con le frecce e non prende la fermata.
function installRadioGroup(
  group: HTMLElement,
  select: (button: HTMLButtonElement) => void,
): void {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
  if (buttons.length === 0) return;
  settleRadioGroup(group);

  const activate = (button: HTMLButtonElement): void => {
    for (const candidate of buttons) {
      const selected = candidate === button;
      candidate.setAttribute("aria-checked", String(selected));
      candidate.tabIndex = selected ? 0 : -1;
    }
    button.focus();
    select(button);
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (!button.disabled) activate(button);
    });
    button.addEventListener("keydown", (event) => {
      const enabled = buttons.filter((candidate) => !candidate.disabled);
      const index = enabled.indexOf(button);
      if (index === -1) return;
      let next: number | null = null;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (index - 1 + enabled.length) % enabled.length;
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (index + 1) % enabled.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = enabled.length - 1;
      }
      if (next === null) return;
      event.preventDefault();
      activate(enabled[next]!);
    });
  }
}

/// La fermata di un radiogroup: la scelta corrente se si può scegliere,
/// altrimenti la prima opzione disponibile.
function settleRadioGroup(group: HTMLElement): void {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
  const enabled = buttons.filter((button) => !button.disabled);
  const checked = enabled.find((button) => button.getAttribute("aria-checked") === "true");
  const tabbable = checked ?? enabled[0];
  for (const button of buttons) button.tabIndex = button === tabbable ? 0 : -1;
}

function selectTab(next: SettingsTab, focus: boolean): void {
  if (tab === "settings" && next !== "settings") {
    void cancelThemePreview();
    cancelCssSnippetsPreview();
  }
  tab = next;
  pinnedRow = null;
  componentsGeneration++;
  syncToolbar();
  const owner = settingsLifetime;
  void render().then(() => {
    if (!focus || owner?.closed || owner !== settingsLifetime) return;
    tabButtons().find((button) => button.dataset.tab === next)?.focus();
  });
}

export function mountSettings(nextHooks: Hooks, parent?: Lifetime): Teardown {
  mountedTeardown?.();
  const lifetime = openLifetime();
  const teardown = () => lifetime.close();
  mountedTeardown = teardown;
  if (parent?.closed) {
    lifetime.close();
    return teardown;
  }
  parent?.add(teardown);
  settingsLifetime = lifetime;

  tab = "settings";
  renderedTab = null;
  resetFilters();
  settingsHooks = nextHooks;
  panelEl = $("#settings-panel");
  bodyEl = $("#settings-body");
  tabsEl = $("#settings-tabs");
  scrollEl = optional("settings-scroll") ?? bodyEl;
  toolbarEl = optional("settings-toolbar");
  searchEl = optional<HTMLInputElement>("settings-search");
  modifiedEl = optional<HTMLButtonElement>("settings-modified");
  countEl = optional("settings-count");
  tocEl = optional("settings-toc");
  tocListEl = optional("settings-toc-list");
  tabsEl.setAttribute("role", "tablist");
  bodyEl.setAttribute("role", "tabpanel");
  bodyEl.id = settingsTabsId;
  const closeButton = $("#settings-close");
  if (closeButton.childElementCount === 0 && closeButton.textContent?.trim() === "") {
    closeButton.innerHTML = icon("close");
  }
  const searchIcon = optional("settings-search-icon");
  if (searchIcon) searchIcon.innerHTML = icon("search");
  lifetime.listen($("#open-settings"), "click", () => void open());
  lifetime.listen(closeButton, "click", () => close());
  for (const button of tabButtons()) {
    const value = button.dataset.tab as SettingsTab;
    button.setAttribute("role", "tab");
    button.id = `settings-tab-${value}`;
    button.setAttribute("aria-controls", settingsTabsId);
    button.tabIndex = value === tab ? 0 : -1;
    button.setAttribute("aria-selected", String(value === tab));
    if (!button.querySelector(".settings-tab-icon") && TAB_ICONS[value]) {
      const figure = document.createElement("span");
      figure.className = "settings-tab-icon";
      figure.setAttribute("aria-hidden", "true");
      figure.innerHTML = icon(TAB_ICONS[value]);
      button.prepend(figure);
    }
    lifetime.listen(button, "click", () => selectTab(value, true));
    lifetime.listen(button, "keydown", (event) => {
      const buttons = tabButtons();
      const index = buttons.indexOf(button);
      const next = moveTab(index, event.key, buttons.length);
      if (next === null) return;
      event.preventDefault();
      const nextTab = buttons[next]?.dataset.tab as SettingsTab | undefined;
      if (nextTab) selectTab(nextTab, true);
    });
  }
  const selectedTab = tabButtons().find((button) => button.dataset.tab === tab);
  if (selectedTab) bodyEl.setAttribute("aria-labelledby", selectedTab.id);
  // La ricerca **non ridisegna**: nasconde righe e sezioni del disegno che c'è.
  // Un ridisegno per tasto rifarebbe le letture IPC a ogni lettera, e
  // toglierebbe il fuoco al campo che si sta usando.
  if (searchEl) {
    const field = searchEl;
    lifetime.listen(field, "input", () => {
      if (!isFilterable(tab)) return;
      pinnedRow = null;
      filters[tab].query = field.value;
      scrollEl.scrollTop = 0;
      applyFilter();
    });
  }
  if (modifiedEl) {
    lifetime.listen(modifiedEl, "click", () => {
      if (!isFilterable(tab)) return;
      pinnedRow = null;
      filters[tab].modified = !filters[tab].modified;
      scrollEl.scrollTop = 0;
      syncToolbar();
      applyFilter();
    });
  }
  lifetime.listen(scrollEl, "scroll", () => updateTocCurrent());
  if (tocListEl) {
    lifetime.listen(tocListEl, "click", (event) => {
      const target = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-target]");
      if (target?.dataset.target) jumpTo(target.dataset.target);
    });
  }
  // Mod+F dentro il pannello cerca **nelle impostazioni**: il tasto della
  // ricerca nel documento sotto non ha senso mentre la modale comanda, e la
  // tastiera globale salta un tasto già gestito (`defaultPrevented`).
  lifetime.listen(panelEl, "keydown", (event) => {
    if (event.key.toLowerCase() !== "f" || !(event.ctrlKey || event.metaKey)) return;
    if (event.altKey || event.shiftKey || !searchEl || !toolbarEl || toolbarEl.hidden) return;
    event.preventDefault();
    searchEl.focus();
    searchEl.select();
  });
  lifetime.add(onLanguage(() => syncToolbar()));
  // Un'impostazione può cambiare **da fuori di qui**: un comando
  // (`settings.set`), un plugin, un'altra finestra. L'evento non porta il valore
  // nuovo apposta — si rilegge, che è l'unica cosa che non può invecchiare.
  // L'errore per-campo della chiave che è cambiata decade con esso: il valore
  // autorevole è appena stato riletto, e un esito vecchio contraddirrebbe la
  // riga. Gli errori delle altre chiavi restano, perché il loro valore no.
  const stopSetting = onEvent("setting_changed", (event) => {
    rowErrors.delete(event.key);
    if (!lifetime.closed && !panelEl.hidden) void render();
  });
  if (typeof stopSetting === "function") lifetime.add(stopSetting);
  // Chiudere il vault mentre il pannello è aperto lascerebbe un form che parla
  // di un vault che non c'è: le impostazioni sono per-vault.
  const stopVault = onEvent("vault_closed", () => close());
  if (typeof stopVault === "function") lifetime.add(stopVault);
  lifetime.add(() => {
    cancelCssSnippetsPreview();
    race.cancel();
    release?.();
    release = null;
  });
  syncToolbar();
  return teardown;
}

let mountedTeardown: Teardown | null = null;
let settingsLifetime: Lifetime | null = null;


/// Come si scioglie la trappola del fuoco, quando il pannello è aperto.
///
/// È `null` a pannello chiuso, ed è il modo in cui `chiudi()` resta idempotente:
/// lo chiamano il pulsante, Escape e l'evento `vault_closed`, e senza questa
/// guardia il secondo giro rimetterebbe il fuoco dove stava *prima del primo*.
let release: (() => void) | null = null;

async function open(): Promise<void> {
  if (settingsLifetime?.closed || release) return;
  panelEl.hidden = false;
  syncToolbar();
  enterSurface(panelEl, { viewTransition: false });
  // Il fuoco entra e resta: mentre le impostazioni sono aperte, sono quello che
  // si sta facendo (è la ragione per cui stanno sopra tutto anche visivamente,
  // scritto accanto al loro `z-index`). Una modale da cui il linguetta scappa mette
  // chi non vede a parlare con la UI sotto, che è ancora lì e non è più quella
  // che ha davanti.
  release = trapFocus(panelEl, close);
  // La trappola mette il fuoco sul primo controllo, che nella scocca è la
  // chiusura: si comincia invece dalla scheda corrente, che dice dove si è.
  tabButtons().find((button) => button.dataset.tab === tab)?.focus();
  await render();
}

function close(): void {
  release?.();
  race.cancel();
  cancelCssSnippetsPreview();
  void cancelThemePreview();
  componentsGeneration++;
  pendingRows.clear();
  rowErrors.clear();
  openDetails.clear();
  release = null;
  renderedTab = null;
  resetFilters();
  if (searchEl) searchEl.value = "";
  exitSurface(
    panelEl,
    () => {
      panelEl.hidden = true;
    },
    { viewTransition: false },
  );
}

/// Quale disegno è l'ultimo chiesto.
///
/// Serve perché `disegna` è **ri-entrante**, e non per un caso di laboratorio:
/// ogni scrittura ne fa partire due — quella di `scrivi`, e quella che il
/// `setting-changed` del kernel fa scattare — e due schede cliccate di fila ne
/// fanno partire altre due. Svuotare *prima* dell'`await` e appendere *dopo*
/// darebbe «svuota, svuota, appendi N, appendi N», cioè il contenuto doppio o
/// due schede mescolate. Qui si costruisce prima e si sostituisce dopo, in un
/// colpo solo, e il disegno che arriva in ritardo si accorge di non essere più
/// l'ultimo e si ritira.
const race = new Race();

async function render(): Promise<void> {
  const owner = settingsLifetime;
  if (!owner || owner.closed || owner !== settingsLifetime) return;
  const buttons = tabButtons();
  for (const button of buttons) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("role", "tab");
    button.id = `settings-tab-${button.dataset.tab ?? ""}`;
    button.setAttribute("aria-controls", settingsTabsId);
    button.tabIndex = selected ? 0 : -1;
    // La classe la vedeva chi guarda, `aria-selected` chi ascolta: erano la
    // stessa informazione detta a metà delle persone, e scritto due volte.
    // Adesso è scritto una volta sola, e la pelle legge quella.
    button.setAttribute("aria-selected", String(selected));
  }
  const selected = buttons.find((button) => button.dataset.tab === tab);
  if (selected) bodyEl.setAttribute("aria-labelledby", selected.id);
  else bodyEl.removeAttribute("aria-labelledby");
  const nodes = await race.last(async (expected) => {
    // Il `catch` sta **sulla promessa e non attorno all'attesa**, ed è la
    // differenza che questa migrazione ha reso visibile: un `try` attorno
    // all'`atteso` ingoierebbe il segnale di scadenza insieme all'errore di
    // lettura, e il giro vecchio tornerebbe a scrivere. Qui l'errore è già un
    // valore quando arriva al cancello.
    //
    // Un pannello che non riesce a leggere lo dice: il §20.2 avrà il canale
    // vero, e finché non c'è questo è il posto più visibile che ha.
    return expected(
      tabContent().catch((e: unknown) => [
        row("muted settings-note", t("settings.read_failed", { reason: errorText(e) })),
      ]),
    );
  });
  if (!nodes || owner.closed || owner !== settingsLifetime) return;
  // Sostituire tutto il corpo lo accorcia per un istante: lo scroll si rimette
  // a mano dov'era, e torna in cima solo quando cambia la scheda.
  const scrollTop = scrollEl.scrollTop;
  bodyEl.replaceChildren(...nodes);
  scrollEl.scrollTop = renderedTab === tab ? scrollTop : 0;
  renderedTab = tab;
  syncToolbar();
  buildToc();
  applyFilter();
}

function tabContent(): Promise<HTMLElement[]> {
  if (tab === "settings") return renderForm();
  if (tab === "components") return renderComponents();
  if (tab === "shortcuts") return renderShortcuts();
  return renderVault();
}

// --- ricerca e filtro -------------------------------------------------------
//
// Due schede si cercano — la configurazione e le scorciatoie — e ciascuna ha
// la sua ricerca: passare da una all'altra non deve lasciare «tema» a filtrare
// le scorciatoie. Le righe portano già quel che serve per filtrarle
// (`data-search`, `data-modified`), così il filtro non tocca l'IPC.

type FilterableTab = "settings" | "shortcuts";

interface Filter {
  query: string;
  modified: boolean;
}

const filters: Record<FilterableTab, Filter> = {
  settings: { query: "", modified: false },
  shortcuts: { query: "", modified: false },
};

/// La riga appena scritta resta in vista anche se il filtro ora la
/// escluderebbe (azzerata sotto «Solo modificate», una combinazione cambiata
/// che non corrisponde più alla ricerca): sparire sotto il puntatore sarebbe
/// perdere il fuoco e l'esito. Vale finché il filtro non cambia.
let pinnedRow: string | null = null;

function resetFilters(): void {
  pinnedRow = null;
  for (const filter of Object.values(filters)) {
    filter.query = "";
    filter.modified = false;
  }
}

function isFilterable(which: SettingsTab): which is FilterableTab {
  return which === "settings" || which === "shortcuts";
}

/// La barra segue la scheda: si vede dove c'è qualcosa da cercare, e il campo
/// dice che cosa cerca.
function syncToolbar(): void {
  if (!toolbarEl) return;
  const current = tab;
  toolbarEl.hidden = !isFilterable(current);
  if (!isFilterable(current)) return;
  const filter = filters[current];
  if (searchEl) {
    if (searchEl.value !== filter.query) searchEl.value = filter.query;
    const shortcuts = current === "shortcuts";
    searchEl.setAttribute("aria-label", t(shortcuts ? "settings.shortcuts.filter" : "settings.search"));
    searchEl.placeholder = t(shortcuts ? "settings.shortcuts.filter_placeholder" : "settings.search.placeholder");
  }
  modifiedEl?.setAttribute("aria-pressed", String(filter.modified));
}

/// Nasconde ciò che il filtro esclude, e le sezioni rimaste vuote.
function applyFilter(): void {
  for (const stale of bodyEl.querySelectorAll(".settings-empty")) stale.remove();
  if (!isFilterable(tab)) {
    if (countEl) countEl.textContent = "";
    syncTocEntries();
    return;
  }
  const { query, modified } = filters[tab];
  const terms = searchTerms(query);
  const active = terms.length > 0 || modified;
  let shown = 0;
  for (const item of bodyEl.querySelectorAll<HTMLElement>("[data-search]")) {
    const visible =
      (pinnedRow !== null && item.dataset.settingKey === pinnedRow) ||
      ((!modified || item.dataset.modified === "true") && matchesTerms(item.dataset.search ?? "", terms));
    item.hidden = !visible;
    if (visible) shown++;
  }
  for (const section of sections()) {
    if (!section.querySelector("[data-search]")) continue;
    section.hidden = section.querySelector("[data-search]:not([hidden])") === null;
  }
  if (countEl) {
    countEl.textContent = active ? plural(shown, "settings.search.count.one", "settings.search.count") : "";
  }
  if (active && shown === 0) {
    const empty = document.createElement("div");
    empty.className = "settings-empty";
    const trimmed = query.trim();
    empty.append(row("settings-empty-text", trimmed
      ? t("settings.search.none", { query: trimmed })
      : t("settings.search.none_modified")));
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "settings-btn";
    clear.textContent = t("settings.search.clear");
    clear.addEventListener("click", () => {
      if (!isFilterable(tab)) return;
      pinnedRow = null;
      filters[tab].query = "";
      filters[tab].modified = false;
      syncToolbar();
      applyFilter();
      searchEl?.focus();
    });
    empty.append(clear);
    bodyEl.append(empty);
  }
  syncTocEntries();
}

// --- l'indice delle sezioni -------------------------------------------------

/// Le sezioni del disegno corrente, nell'ordine in cui si leggono.
function sections(): HTMLElement[] {
  return [...bodyEl.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("settings-section"),
  );
}

/// Una voce per sezione, col numero delle modificate quando ce ne sono. Sotto
/// le due sezioni l'indice non serve: si vede già tutto.
function buildToc(): void {
  if (!tocEl || !tocListEl) return;
  const all = sections();
  tocListEl.replaceChildren(...all.map((section) => {
    const item = document.createElement("li");
    const link = document.createElement("button");
    link.type = "button";
    link.className = "settings-toc-link";
    link.dataset.target = section.id;
    const name = document.createElement("span");
    name.className = "settings-toc-name";
    name.textContent = section.querySelector(".settings-section-title")?.textContent ?? "";
    link.append(name);
    const count = Number(section.dataset.modifiedCount ?? "0");
    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "settings-toc-badge";
      badge.textContent = String(count);
      badge.setAttribute("aria-hidden", "true");
      link.append(badge);
      setTooltip(link, plural(count, "settings.group.modified.one", "settings.group.modified"));
    }
    item.append(link);
    return item;
  }));
  tocEl.hidden = all.length < 2;
}

/// Le voci seguono il filtro: una sezione nascosta non ha voce.
function syncTocEntries(): void {
  if (!tocListEl || !tocEl) return;
  let visible = 0;
  for (const link of tocListEl.querySelectorAll<HTMLButtonElement>("button[data-target]")) {
    const target = link.dataset.target ? document.getElementById(link.dataset.target) : null;
    const item = link.closest("li");
    const shown = target !== null && !target.hidden;
    if (item) item.hidden = !shown;
    if (shown) visible++;
  }
  // Un indice senza voci è un titolo che non indica niente: sparisce con loro.
  tocEl.hidden = tocListEl.childElementCount < 2 || visible === 0;
  updateTocCurrent();
}

/// La sezione in lettura: l'ultima il cui titolo è salito oltre il bordo alto
/// del corpo. In fondo allo scroll è l'ultima, anche se è corta e il suo titolo
/// non può salire fin lassù.
function updateTocCurrent(): void {
  if (!tocListEl || !tocEl || tocEl.hidden) return;
  const visible = sections().filter((section) => !section.hidden);
  if (visible.length === 0) return;
  const top = scrollEl.getBoundingClientRect().top;
  let current = visible[0]!;
  const atEnd = scrollEl.scrollTop > 0 && scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2;
  if (atEnd) current = visible[visible.length - 1]!;
  else {
    for (const section of visible) {
      if (section.getBoundingClientRect().top - top <= 32) current = section;
      else break;
    }
  }
  for (const link of tocListEl.querySelectorAll<HTMLButtonElement>("button[data-target]")) {
    if (link.dataset.target === current.id) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

/// Porta a una sezione: la scorre in cima e le dà il fuoco, così chi naviga da
/// tastiera prosegue da lì invece che dall'indice.
function jumpTo(id: string): void {
  const section = document.getElementById(id);
  if (!section || !bodyEl.contains(section)) return;
  section.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  section.querySelector<HTMLElement>(".settings-section-title")?.focus({ preventScroll: true });
  for (const link of tocListEl?.querySelectorAll<HTMLButtonElement>("button[data-target]") ?? []) {
    if (link.dataset.target === id) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

/// Una sezione: il titolo (un `h3` che l'indice sa raggiungere), le azioni
/// dell'intestazione e il corpo — una scheda per le righe, o un contenitore
/// semplice quando dentro ci stanno altre schede.
interface SectionParts {
  section: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
}

function sectionBlock(title: string, index: number, options: { card?: boolean; hint?: string } = {}): SectionParts {
  const section = document.createElement("section");
  section.className = "settings-section";
  section.id = sectionAnchor(title, index);
  const head = document.createElement("div");
  head.className = "settings-section-head";
  const heading = document.createElement("h3");
  heading.className = "settings-section-title";
  heading.id = `${section.id}-title`;
  heading.tabIndex = -1;
  heading.textContent = title;
  head.append(heading);
  section.setAttribute("aria-labelledby", heading.id);
  section.append(head);
  if (options.hint) section.append(row("muted settings-section-hint", options.hint));
  const body = document.createElement("div");
  body.className = options.card === false ? "settings-section-body" : "settings-card";
  section.append(body);
  return { section, head, body };
}

/// Il conto delle righe modificate di una sezione, detto accanto al titolo e
/// ripreso dall'indice.
function markModified(parts: SectionParts, count: number): void {
  if (count === 0) return;
  parts.section.dataset.modifiedCount = String(count);
  const meta = document.createElement("span");
  meta.className = "settings-section-meta";
  meta.textContent = plural(count, "settings.group.modified.one", "settings.group.modified");
  parts.head.querySelector(".settings-section-title")?.after(meta);
}

// --- la scheda delle impostazioni -------------------------------------------

/// Le chiavi che sono **scorciatoie**, e non righe di configurazione.
///
/// Non si riconoscono dal prefisso della chiave — sarebbe indovinare — ma
/// componendole: per ogni comando si sa quale chiave gli è stata fabbricata,
/// perché la regola è una sola e sta scritto in `keybindingKey` (§18.2). È la
/// stessa mossa con cui questa shell riconosce qualunque altra cosa attraversi
/// il confine: rifà il conto invece di leggere una convenzione.
/// **Tutti i comandi**, e non più i soli comandi del kernel: da quando anche
async function renderForm(): Promise<HTMLElement[]> {
  const shortcuts = new Set(allCommands().map((command) => keybindingKey(command.id)));
  // Le scorciatoie **non stanno qui**: sono impostazioni come le altre, e
  // proprio per questo sarebbero venti righe senza gruppo in fondo alla scheda
  // della configurazione. Hanno una scheda loro, ed è la stessa forma — un
  // campo di testo, una sourceLabel, un «azzera» — perché è la stessa cosa.
  // E nemmeno i **permessi** (§23.17), per la stessa ragione e con lo stesso
  // conto rifatto: sono impostazioni come le altre, quindi finirebbero qui
  // come settanta righe senza gruppo la cui etichetta è una chiave nuda. Le
  // disegna la scheda dei componenti, accanto a chi le ha chieste, che è
  // l'unico posto in cui significano qualcosa.
  const entries = (await settings()).filter(
    (e) => !shortcuts.has(e.spec.key) && !isPermissionKey(e.spec.key) && !MANAGED_ELSEWHERE.has(e.spec.key),
  );
  const nodes: HTMLElement[] = [];
  if (entries.length === 0) nodes.push(row("muted settings-note", t("settings.none")));
  const themes = await themeCatalog().catch(() => []);
  const groups = groupEntries(entries);
  for (const [index, group] of groups.entries()) {
    const parts = sectionBlock(group.title, index);
    const changed = group.rows.filter(isModified);
    markModified(parts, changed.length);
    const reset = groupReset(group, changed);
    if (reset) parts.head.append(reset);
    for (const entry of group.rows) {
      // I frammenti CSS e il catalogo dei temi sono blocchi, non righe, e
      // stanno **nel loro gruppo**: in fondo al form finivano sotto
      // «Diagnostica», lontani dall'aspetto che cambiano.
      if (entry.spec.key === CSS_SNIPPETS_KEY) {
        parts.body.append(renderCssSnippets(entry));
        continue;
      }
      const item = renderRow(entry);
      if (entry.spec.key === FRAME_KEY) await decorateFrame(item, entry);
      parts.body.append(item);
    }
    if (themes.length > 0 && group.rows.some((entry) => entry.spec.key === THEME_KEY)) {
      parts.body.append(renderThemeCatalog(themes));
    }
    nodes.push(parts.section);
  }
  nodes.push(await renderProfiles(groups.length));
  return nodes;
}

/// Le chiavi che hanno un gesto loro altrove, e che nel form generico sarebbero
/// un campo da non toccare a mano. L'elenco arriva generato da chi le possiede
/// (`fub_host::shell::SETTINGS_WITH_THEIR_OWN_GESTURE`): i tipi delle proprietà,
/// per esempio, sono del kernel e non della shell.
const MANAGED_ELSEWHERE = new Set(SETTINGS_WITH_THEIR_OWN_GESTURE);

/// La cornice della finestra: le sue scelte dipendono da ciò che il sistema
/// offre, e cambiarla può chiedere di riaprire la finestra.
const FRAME_KEY = "chrome.frame";

async function decorateFrame(item: HTMLElement, entry: SettingEntry): Promise<void> {
  const [capabilities, reopen] = await Promise.allSettled([
    Promise.resolve().then(() => api.frameCapabilities()),
    Promise.resolve().then(() => api.settingRequiresReopen(entry.spec.key)),
  ]);
  const text = item.querySelector(".setting-text");
  const control = item.querySelector<HTMLElement>("select, [role=radiogroup]");
  const choices = [...item.querySelectorAll<HTMLOptionElement | HTMLButtonElement>("option, button[data-choice]")];
  const valueOf = (choice: HTMLOptionElement | HTMLButtonElement) =>
    choice instanceof HTMLOptionElement ? choice.value : choice.dataset.choice ?? "";
  if (capabilities.status === "fulfilled") {
    for (const choice of choices) {
      // Solo spegnere: una riga in volo ha già i suoi controlli disabilitati,
      // e riaccenderli qui aprirebbe una seconda scrittura della stessa chiave.
      if (valueOf(choice) === "system" && !capabilities.value.system) choice.disabled = true;
      if (valueOf(choice) === "custom" && !capabilities.value.custom) choice.disabled = true;
    }
    if (!capabilities.value.system && !capabilities.value.custom) disableControl(control);
  } else {
    disableControl(control);
    text?.append(row("setting-source", t("settings.frame.unavailable", { reason: errorText(capabilities.reason) })));
  }
  if (reopen.status === "fulfilled" && reopen.value) {
    text?.append(row("setting-source", t("settings.frame.reopen")));
  }
  if (control?.getAttribute("role") === "radiogroup") settleRadioGroup(control);
}

function disableControl(control: HTMLElement | null): void {
  if (!control) return;
  if (control instanceof HTMLSelectElement) {
    control.disabled = true;
    return;
  }
  control.setAttribute("aria-disabled", "true");
  for (const button of control.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
}

/// «Ripristina gruppo», quando nel gruppo c'è qualcosa di diverso dal default:
/// riportare indietro una sezione intera era un «Azzera» riga per riga.
function groupReset(group: Group, changed: SettingEntry[]): HTMLButtonElement | null {
  if (changed.length === 0) return null;
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "link-button settings-section-reset";
  reset.textContent = t("settings.group.reset");
  setTooltip(reset, t("settings.group.reset.hint", { group: group.title }));
  reset.addEventListener("click", () => {
    void (async () => {
      const accepted = await confirm(
        t("settings.group.reset.confirm", { group: group.title, count: changed.length }),
        { title: t("settings.group.reset"), okLabel: t("settings.group.reset.ok"), danger: true },
      );
      if (!accepted || settingsLifetime?.closed) return;
      await write(async () => {
        for (const entry of changed) await api.resetSetting(entry.spec.key);
      });
    })();
  });
  return reset;
}

/// Un blocco dentro una scheda: titolo e prosa in alto, il contenuto sotto a
/// tutta larghezza. È la forma del catalogo dei temi e dei frammenti CSS, che
/// non stanno in una colonna di controllo.
function blockHead(el: HTMLElement, title: string, hint: string): HTMLElement {
  const text = document.createElement("div");
  text.className = "setting-text";
  const name = document.createElement("div");
  name.className = "setting-label";
  name.setAttribute("role", "heading");
  name.setAttribute("aria-level", "4");
  name.textContent = title;
  text.append(name, row("muted", hint));
  el.append(text);
  return text;
}

function renderCssSnippets(entry: SettingEntry): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "setting-row setting-block";
  panel.dataset.settingKey = CSS_SNIPPETS_KEY;
  panel.dataset.search = searchText(entry, entry.spec.label, t("settings.css.hint"));
  if (isModified(entry)) panel.dataset.modified = "true";
  blockHead(panel, entry.spec.label, t("settings.css.hint"));
  const source = document.createElement("textarea");
  source.className = "setting-code";
  source.setAttribute("aria-label", entry.spec.label);
  source.rows = 7;
  source.spellcheck = false;
  source.value = typeof entry.value === "string" ? entry.value : DEFAULT_CSS_SNIPPETS;
  const status = row("setting-source", t("settings.css.trust"));
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "settings-btn";
  preview.textContent = t("settings.css.preview");
  preview.addEventListener("click", () => {
    try {
      previewCssSnippets(source.value);
      status.textContent = t("settings.css.preview_active");
    } catch (error) {
      status.textContent = t("settings.css.rejected", { reason: errorText(error) });
    }
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "settings-btn";
  cancel.textContent = t("settings.css.cancel_preview");
  cancel.addEventListener("click", () => {
    cancelCssSnippetsPreview();
    status.textContent = t("settings.css.preview_cancelled");
  });
  const save = document.createElement("button");
  save.type = "button";
  save.className = "settings-btn";
  save.textContent = t("settings.css.save");
  save.addEventListener("click", () => {
    save.disabled = true;
    void saveCssSnippets(source.value).then(() => {
      if (panel.isConnected) void render();
    }).catch((error: unknown) => {
      status.textContent = t("settings.css.not_saved", { reason: errorText(error) });
    }).finally(() => { save.disabled = false; });
  });
  actions.append(preview, cancel, save);
  panel.append(source, actions, status);
  try {
    const snippets = parseCssSnippets(source.value);
    const errors = new Map(cssSnippetCatalog().map((item) => [item.id, item.error]));
    for (const snippet of snippets.snippets) {
      const line = document.createElement("div");
      line.className = "setting-snippet";
      line.append(row("setting-source", t(snippet.enabled ? "settings.css.snippet_on" : "settings.css.snippet_off", { id: snippet.id }) + (errors.get(snippet.id) ? ` · ${errors.get(snippet.id)}` : "")));
      if (snippet.enabled) {
        const off = document.createElement("button");
        off.type = "button";
        off.className = "link-button";
        off.textContent = t("settings.css.disable", { id: snippet.id });
        off.addEventListener("click", () => void write(() => disableCssSnippet(snippet.id)));
        line.append(off);
      }
      panel.append(line);
    }
  } catch (error) {
    panel.append(row("setting-source", t("settings.css.needs_repair", { reason: errorText(error) })));
  }
  return panel;
}

/// I profili: una sezione in fondo alla configurazione, una scheda per
/// ambito. In vista resta il gesto comune — quale profilo è attivo e come
/// cambiarlo —; quelli rari (duplicare, esportare, importare, azzerare) stanno
/// in un riquadro che si apre.
async function renderProfiles(index: number): Promise<HTMLElement> {
  const scopes: { scope: SettingScope; vault?: string }[] = [{ scope: "machine" }];
  if (state.vaultRoot) scopes.push({ scope: "vault", vault: state.vaultRoot });
  const results = await Promise.allSettled(scopes.map(({ scope, vault }) =>
    Promise.resolve().then(() => api.settingsProfiles(scope, vault))));
  const parts = sectionBlock(t("settings.profiles.title"), index, { card: false });
  for (const [position, { scope, vault }] of scopes.entries()) {
    const title = t(scope === "machine" ? "settings.profiles.machine" : "settings.profiles.vault");
    const box = document.createElement("div");
    box.className = "settings-card settings-profile";
    box.dataset.profileScope = scope;
    box.dataset.search = normalizeSearch(`${title} ${t("settings.profiles.title")}`);
    const head = document.createElement("div");
    head.className = "setting-row";
    const text = document.createElement("div");
    text.className = "setting-text";
    const name = document.createElement("div");
    name.className = "setting-label";
    name.setAttribute("role", "heading");
    name.setAttribute("aria-level", "4");
    name.textContent = title;
    text.append(name);
    head.append(text);
    box.append(head);
    parts.body.append(box);
    const result = results[position]!;
    if (result.status === "rejected") {
      text.append(row("muted", t("settings.profiles.unavailable", { reason: errorText(result.reason) })));
      continue;
    }
    const { active, names } = result.value;
    text.append(row("setting-source", t("settings.profiles.active", { profile: active })));
    const feedback = row("setting-source", t("settings.profiles.hint"));
    feedback.setAttribute("role", "status");
    text.append(feedback);
    const choice = document.createElement("select");
    choice.setAttribute("aria-label", t("settings.profiles.choice"));
    for (const profile of names) {
      const option = document.createElement("option");
      option.value = profile;
      option.textContent = profile;
      option.selected = profile === active;
      choice.append(option);
    }
    const control = document.createElement("div");
    control.className = "setting-control settings-actions";
    head.append(control);
    const { details: manage, body: inside } = openableDetails(`profiles:${scope}`, t("settings.profiles.manage"));
    box.append(manage);
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "setting-input";
    nameInput.placeholder = t("settings.profiles.new_name");
    nameInput.setAttribute("aria-label", t("settings.profiles.new_name"));
    const json = document.createElement("textarea");
    json.className = "setting-code";
    json.rows = 5;
    json.spellcheck = false;
    json.placeholder = t("settings.profiles.json_placeholder");
    json.setAttribute("aria-label", t("settings.profiles.json"));
    let busy = false;
    const perform = async (action: () => Promise<unknown>, redraw = true) => {
      if (busy) return;
      busy = true;
      for (const button of box.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
      try {
        await action();
        if (settingsLifetime?.closed || !box.isConnected) return;
        if (redraw) {
          feedback.textContent = t("settings.profiles.saved");
          await render();
        }
      } catch (error) {
        if (box.isConnected) feedback.textContent = t("settings.profiles.not_changed", { reason: errorText(error) });
      } finally {
        busy = false;
        for (const button of box.querySelectorAll<HTMLButtonElement>("button")) button.disabled = false;
      }
    };
    const button = (parent: HTMLElement, title: string, action: () => void, danger = false) => {
      const control = document.createElement("button");
      control.type = "button";
      control.className = danger ? "settings-btn settings-btn--danger" : "settings-btn";
      control.textContent = title;
      control.addEventListener("click", action);
      parent.append(control);
    };
    control.append(choice);
    button(control, t("settings.profiles.switch"), () => void perform(() => api.switchSettingsProfile(scope, choice.value, vault)));
    const duplicateRow = document.createElement("div");
    duplicateRow.className = "settings-actions";
    duplicateRow.append(nameInput);
    button(duplicateRow, t("settings.profiles.duplicate"), () => {
      if (!nameInput.value.trim()) { feedback.textContent = t("settings.profiles.name_required"); return; }
      void perform(() => api.duplicateSettingsProfile(scope, choice.value, nameInput.value.trim(), vault));
    });
    const transfer = document.createElement("div");
    transfer.className = "settings-actions";
    button(transfer, t("settings.profiles.export"), () => void perform(async () => {
      json.value = await api.exportSettingsProfile(scope, choice.value, vault);
      feedback.textContent = t("settings.profiles.exported");
    }, false));
    button(transfer, t("settings.profiles.import"), () => {
      if (!json.value.trim()) { feedback.textContent = t("settings.profiles.json_required"); return; }
      // Pass the source verbatim. Parsing/reserializing here would discard
      // opaque values the native profile store knows how to retain.
      void perform(() => api.importSettingsProfile(scope, json.value, vault));
    });
    button(transfer, t("settings.profiles.reset"), () => {
      void (async () => {
        const accepted = await confirm(t("settings.profiles.reset_confirm", { profile: choice.value }), {
          title: t("settings.profiles.reset_title"), okLabel: t("settings.profiles.reset_ok"), danger: true,
        });
        if (accepted && box.isConnected) await perform(() => api.resetSettingsProfile(scope, choice.value, vault));
      })().catch((error: unknown) => { feedback.textContent = t("settings.profiles.reset_cancelled", { reason: errorText(error) }); });
    }, true);
    inside.append(duplicateRow, json, transfer, row("muted", t("settings.profiles.frame_hint")));
  }
  return parts.section;
}

function renderThemeCatalog(themes: ThemeInfo[]): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "setting-row setting-block";
  const text = blockHead(panel, t("settings.themes.title"), t("settings.themes.preview_hint"));
  panel.dataset.search = normalizeSearch([
    t("settings.themes.title"),
    t("settings.themes.preview_hint"),
    ...themes.map((theme) => `${theme.manifest.name} ${theme.manifest.id}`),
  ].join(" "));

  const control = document.createElement("div");
  control.className = "segmented segmented--wide setting-segmented";
  control.setAttribute("role", "radiogroup");
  control.setAttribute("aria-label", t("settings.themes.title"));

  const currentPreview = currentThemePreview();
  const renderedId = currentPreview?.id ?? currentThemeId();
  const renderedLight =
    currentPreview?.light ??
    (document.documentElement.dataset.theme === "light" ? "light" : "dark");

  const labels = new Map<string, string>();
  for (const theme of themes) {
    for (const light of theme.manifest.lights) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segmented-option";
      const label = t("settings.themes.option", {
        name: theme.manifest.name,
        light: t(
          light === "dark" ? "settings.themes.light.dark" : "settings.themes.light.light",
        ),
      });
      button.textContent = `${label} · ${t(TRUST_LABELS[theme.trust])}`;
      button.dataset.themeId = theme.manifest.id;
      button.dataset.themeLight = light;
      button.setAttribute("role", "radio");
      button.setAttribute(
        "aria-checked",
        String(renderedId === theme.manifest.id && renderedLight === light),
      );
      labels.set(theme.manifest.id + ":" + light, label);
      control.append(button);
    }
  }

  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "settings-btn";
  applyButton.textContent = t("settings.themes.apply");
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "settings-btn";
  cancelButton.textContent = t("settings.themes.cancel_preview");
  const status = row("setting-source", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const refreshPreviewState = (): void => {
    const preview = currentThemePreview();
    applyButton.disabled = preview === null;
    cancelButton.disabled = preview === null;
    status.textContent = preview
      ? t("settings.themes.preview_active", {
          theme: labels.get(preview.id + ":" + preview.light) ?? preview.id,
        })
      : t("settings.themes.preview_none");
  };

  installRadioGroup(control, (button) => {
    const id = button.dataset.themeId!;
    const light = button.dataset.themeLight as "light" | "dark";
    void previewTheme(id, light)
      .then(refreshPreviewState)
      .catch((error: unknown) => {
        notify(t("settings.themes.preview_failed", { reason: errorText(error) }), "guasto");
        void render();
      });
  });

  applyButton.addEventListener("click", () => {
    const preview = currentThemePreview();
    if (!preview) return;
    void write(() => selectTheme(preview.id, preview.light));
  });
  cancelButton.addEventListener("click", () => {
    void write(() => cancelThemePreview());
  });
  actions.append(applyButton, cancelButton, status);
  refreshPreviewState();

  text.append(
    row(
      "setting-source",
      t("settings.themes.source", {
        ids: themes.map((theme) => theme.manifest.id).join(", "),
      }),
    ),
  );
  panel.append(control, actions);
  return panel;
}

/// Una riga di impostazione.
///
/// `nome` sostituisce l'etichetta dichiarata, e c'è per una sola famiglia: le
/// scorciatoie dei comandi **della shell** (§16.3). La loro chiave la dichiara
/// il bundle di core, che il titolo del comando non ce l'ha — la frase la
/// localizza chi l'ha scritto ([0040]), e chi ha scritto «Apri il pannello dei
/// file» è questa shell. Passarlo di qua costa un parametro; portarne una copia
/// di là costerebbe trentaquattro stringhe tradotte due volte.
///
/// A sinistra l'etichetta, la prosa e una riga di metadati: dove vale il
/// valore e, se qualcuno l'ha scelto, qual è il predefinito e come tornarci. A
/// destra il controllo. Una riga modificata porta un segno sul bordo
/// (`data-modified`), che è anche ciò che il filtro «Solo modificate» legge.
///
/// [0040]: ../../../docs/decisions/0192-impostazioni-locale-e-temi.md
function renderRow(entry: SettingEntry, name?: string, description?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  // Identità stabile della riga: dopo un re-render il focus torna sullo
  // stesso controllo (A03) invece di cadere su BODY.
  el.dataset.settingKey = entry.spec.key;
  const modified = isModified(entry);
  if (modified) el.dataset.modified = "true";
  const label = name ?? entry.spec.label;
  const below = description ?? entry.spec.description;
  el.dataset.search = searchText(entry, label, below);

  const controlId = `setting-${entry.spec.key}`;
  const text = document.createElement("div");
  text.className = "setting-text";
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  labelEl.htmlFor = controlId;
  labelEl.id = `${controlId}-label`;
  text.append(labelEl);
  const described: string[] = [];
  if (below) {
    const desc = row("muted setting-description", below);
    desc.id = `${controlId}-desc`;
    described.push(desc.id);
    text.append(desc);
  }
  text.append(rowMeta(entry, modified));
  // La frase intera sulla provenienza: la pastiglia la dice in breve a chi
  // guarda, questa la dice per intero a chi ascolta, arrivando sul campo.
  const source = document.createElement("span");
  source.className = "sr-only";
  source.id = `${controlId}-source`;
  source.textContent = sourceLabel(entry);
  described.push(source.id);
  text.append(source);
  const pending = pendingRows.has(entry.spec.key);
  const failure = rowErrors.get(entry.spec.key);
  if (pending) el.setAttribute("aria-busy", "true");

  const control = document.createElement("div");
  control.className = "setting-control";
  control.append(field(entry));
  // Chi arriva al campo col lettore di schermo sente anche cosa fa e dove
  // vale, non solo l'etichetta: la prosa sotto la riga era solo per gli occhi.
  for (const focusable of control.querySelectorAll<HTMLElement>("input, select, textarea, [role=radiogroup]")) {
    const existing = focusable.getAttribute("aria-describedby");
    focusable.setAttribute("aria-describedby", [...described, ...(existing ? [existing] : [])].join(" "));
  }
  el.append(text, control);
  if (pending) text.append(rowPending());
  else if (failure) text.append(rowErrorNode(failure));

  // Disabilitare solo la riga in volo, «azzera» compreso: le altre righe
  // restano scrivibili.
  if (pending) {
    for (const node of el.querySelectorAll("input, select, button")) {
      (node as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
    }
  }
  return el;
}

/// La riga dei metadati: la pastiglia dell'ambito e, per una riga modificata,
/// il predefinito e «Azzera».
///
/// «Azzera» compare **solo dove c'è qualcosa da azzerare**: su una riga al
/// valore predefinito sarebbe un pulsante che non fa niente, cioè un pulsante
/// che insegna a non fidarsi dei pulsanti. E accanto dice a cosa riporta:
/// senza, «azzera» era un salto nel buio.
function rowMeta(entry: SettingEntry, modified: boolean): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "setting-meta";
  meta.append(scopeChip(entry.spec.scope));
  if (!modified) return meta;
  // Lingua e fuso vuoti vogliono dire «come il sistema», ed è così che li
  // chiama il loro controllo: il predefinito deve dirlo con la stessa parola.
  const empty = SYSTEM_WHEN_EMPTY.has(entry.spec.key) ? t("settings.as_system") : undefined;
  meta.append(row("setting-default", t("settings.default", { value: defaultText(entry, empty) })));
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "link-button setting-reset";
  resetButton.textContent = t("settings.reset");
  setTooltip(resetButton, t("settings.reset.hint"));
  resetButton.addEventListener("click", () => {
    void writeRow(entry.spec.key, null, () => api.resetSetting(entry.spec.key));
  });
  meta.append(resetButton);
  return meta;
}

/// Dove vale un valore, in una pastiglia: la macchina o il vault. È nascosta a
/// chi ascolta, che la sente per intero dalla frase della provenienza.
function scopeChip(scope: SettingScope): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "setting-scope";
  chip.dataset.scope = scope;
  chip.setAttribute("aria-hidden", "true");
  const figure = document.createElement("span");
  figure.className = "setting-scope-icon";
  figure.innerHTML = icon(scope === "machine" ? "monitor" : "vault");
  const words = document.createElement("span");
  words.textContent = t(scope === "machine" ? "settings.scope.chip.machine" : "settings.scope.chip.vault");
  chip.append(figure, words);
  setTooltip(chip, t(scope === "machine" ? "settings.scope.chip.machine.hint" : "settings.scope.chip.vault.hint"));
  return chip;
}

// Una lista resta una dichiarazione generica del contratto. L'editor compare
// solo per le chiavi per cui la shell possiede un gesto utente esplicito:
// `program_writable` è deliberatamente un'altra capacità.
const editableListKeys = new Set(["files.excluded-folders"]);
const structuralFolderKeys = new Set([".fub", ".trash", ".", ".."]);

function normalizedFolder(raw: string): string {
  let folder = raw.trim().replaceAll("\\", "/");
  while (folder.startsWith("/")) folder = folder.slice(1);
  while (folder.endsWith("/")) folder = folder.slice(0, -1);
  return folder.trim().normalize("NFC");
}

function folderKey(folder: string): string {
  return folder.normalize("NFC").toLowerCase();
}

function normalizedList(value: SettingValue): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    const folder = normalizedFolder(raw);
    const key = folderKey(folder);
    if (!folder || seen.has(key)) continue;
    seen.add(key);
    result.push(folder);
  }
  return result;
}

function checkedFolder(
  raw: string,
  existing: string[],
): { value: string } | { message: string } {
  const value = normalizedFolder(raw);
  if (!value) return { message: t("settings.list.empty") };
  if (value.includes("/")) return { message: t("settings.list.path") };
  const key = folderKey(value);
  if (structuralFolderKeys.has(key)) {
    return { message: t("settings.list.structural", { folder: value }) };
  }
  if (existing.some((folder) => folderKey(folder) === key)) {
    return { message: t("settings.list.duplicate", { folder: value }) };
  }
  return { value };
}

/// Una lista in sola lettura: le voci come pastiglie, «niente» se è vuota.
function readonlyListField(entry: SettingEntry, id: string): HTMLElement {
  const values = Array.isArray(entry.value) ? entry.value : [];
  if (values.length === 0) {
    const el = row("muted", show(entry.value));
    el.id = id;
    return el;
  }
  const list = document.createElement("ul");
  list.className = "setting-chips";
  list.id = id;
  for (const value of values) {
    const item = document.createElement("li");
    item.className = "setting-chip";
    item.textContent = value;
    list.append(item);
  }
  return list;
}

function listField(entry: SettingEntry, id: string): HTMLElement {
  const values = normalizedList(entry.value);
  const editor = document.createElement("div");
  editor.className = "setting-list";

  if (values.length === 0) editor.append(row("muted", t("settings.list.none")));
  else {
    const list = document.createElement("ul");
    list.className = "setting-chips";
    for (const [index, folder] of values.entries()) {
      const item = document.createElement("li");
      item.className = "setting-chip";
      item.append(document.createTextNode(folder));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "setting-chip-remove";
      remove.innerHTML = icon("close");
      remove.setAttribute("aria-label", t("settings.list.remove.hint", { folder }));
      setTooltip(remove, t("settings.list.remove"));
      remove.addEventListener("click", () => {
        void writeRow(entry.spec.key, folder, () =>
          api.setSetting(
            entry.spec.key,
            values.filter((_, candidate) => candidate !== index),
          ),
        );
      });
      item.append(remove);
      list.append(item);
    }
    editor.append(list);
  }

  const form = document.createElement("form");
  form.className = "setting-list-add";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "setting-input";
  input.id = id;
  input.autocomplete = "off";
  input.placeholder = t("settings.list.placeholder");
  const error = row("setting-field-error", "");
  error.id = `${id}-error`;
  error.setAttribute("role", "alert");
  error.setAttribute("aria-live", "polite");
  error.hidden = true;
  input.setAttribute("aria-describedby", error.id);

  const add = document.createElement("button");
  add.type = "submit";
  add.className = "settings-btn";
  add.textContent = t("settings.list.add");
  form.append(input, add, error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const checked = checkedFolder(input.value, values);
    if ("message" in checked) {
      error.textContent = checked.message;
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      return;
    }
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    void writeRow(entry.spec.key, checked.value, async () => {
      await api.setSetting(entry.spec.key, [...values, checked.value]);
    });
  });
  editor.append(form);
  return editor;
}

/// Il campo di una riga, dal **controllo che il modello sceglie** per la sua
/// specie (`controlFor`).
///
/// Un caso per controllo e nessun default: una specie nuova nel contratto
/// arriva come errore di compilazione in `controlFor`, e un controllo nuovo lì
/// arriva come errore qui (`mirror.test.ts` ferma la prima prima ancora), non
/// come una riga che il pannello salta in silenzio.
function field(entry: SettingEntry): HTMLElement {
  const id = `setting-${entry.spec.key}`;
  if (entry.spec.kind.kind === "text" && entry.spec.key === LANGUAGE_KEY) return languageField(entry, id);
  const control: Control = controlFor(entry);
  switch (control.kind) {
    case "switch":
      return switchField(entry, id);
    case "segmented":
      return segmentedField(entry, id, control.options);
    case "select":
      return selectField(entry, id, control.options);
    case "range":
      return rangeField(entry, id, control);
    case "number":
      return numberInput(entry, id, control.min, control.max);
    case "text":
      return textField(entry, id);
    case "list":
      return editableListKeys.has(entry.spec.key)
        ? listField(entry, id)
        : readonlyListField(entry, id);
  }
}

/// Un interruttore: una casella con `role="switch"`, che dice «acceso/spento»
/// invece di «selezionata», e che la pelle disegna come tale. Come ogni
/// interruttore si commuta anche con Invio, non solo con lo Spazio della
/// casella nativa.
function switchInput(id: string, checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "setting-switch";
  input.setAttribute("role", "switch");
  input.id = id;
  input.checked = checked;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || input.disabled) return;
    event.preventDefault();
    input.click();
  });
  return input;
}

function switchField(entry: SettingEntry, id: string): HTMLElement {
  const input = switchInput(id, entry.value === true);
  input.addEventListener("change", () => {
    void writeRow(entry.spec.key, show(input.checked), () =>
      api.setSetting(entry.spec.key, input.checked),
    );
  });
  return input;
}

/// Il campo numerico. `step="any"` perché lo schema non dichiara un passo, e un
/// `2.5` non deve diventare un campo che il browser segna come invalido: lo
/// scoperto lo ha portato il primo numero vero dello schema — i pesi dei campi
/// della ricerca (§21.6), che sono frazionari per natura. Il valore lo
/// controllano i due estremi, che è ciò che il kernel verifica davvero.
function numberInput(entry: SettingEntry, id: string, min: number | null, max: number | null): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "setting-number";
  input.id = id;
  input.value = String(entry.value);
  if (min !== null) input.min = String(min);
  if (max !== null) input.max = String(max);
  input.step = "any";
  input.addEventListener("change", () => {
    // `Number("")` è **zero**, non `NaN`: con il solo controllo su `NaN`,
    // svuotare il campo (o scriverci del testo, che per un `input[number]`
    // dà lo stesso `value` vuoto) manderebbe uno zero al kernel — accettato
    // in silenzio ovunque non ci sia un `min` sopra lo zero.
    if (input.value.trim() === "") return;
    const n = Number(input.value);
    if (Number.isNaN(n)) return;
    void writeRow(entry.spec.key, input.value, () => api.setSetting(entry.spec.key, n));
  });
  return input;
}

/// Un numero con un intervallo: il cursore per il gesto, il campo per il
/// valore preciso. Il cursore scrive **al rilascio** (`change`) e non a ogni
/// passo: trascinarlo da 12 a 28 sarebbero sedici scritture e sedici ridisegni.
/// Mentre si trascina, il campo accanto mostra dove si è.
function rangeField(entry: SettingEntry, id: string, control: Extract<Control, { kind: "range" }>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "setting-range";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "setting-slider";
  slider.id = `${id}-range`;
  slider.min = String(control.min);
  slider.max = String(control.max);
  slider.step = String(control.step);
  slider.value = String(entry.value);
  // Un nome suo, da un'etichetta esplicita: quella visibile della riga è del
  // campo numerico, e un `aria-labelledby` verso di lei non regge quando la
  // riga è fuori dalla vista del corpo che scorre.
  const name = document.createElement("label");
  name.className = "sr-only";
  name.htmlFor = slider.id;
  name.textContent = entry.spec.label;
  const number = numberInput(entry, id, control.min, control.max);
  slider.addEventListener("input", () => {
    number.value = slider.value;
  });
  slider.addEventListener("change", () => {
    const n = Number(slider.value);
    if (!Number.isFinite(n)) return;
    void writeRow(entry.spec.key, slider.value, () => api.setSetting(entry.spec.key, n));
  });
  number.addEventListener("input", () => {
    if (number.value.trim() !== "" && Number.isFinite(Number(number.value))) slider.value = number.value;
  });
  wrap.append(name, slider, number);
  return wrap;
}

function textField(entry: SettingEntry, id: string): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "setting-input";
  input.id = id;
  input.value = String(entry.value);
  const zones = entry.spec.key === TIMEZONE_KEY ? timezoneSuggestions(input) : null;
  input.addEventListener("change", () => {
    const shortcut = allCommands().some((command) => keybindingKey(command.id) === entry.spec.key);
    if (shortcut && !validateKeybinding(input.value).valid) {
      input.setAttribute("aria-invalid", "true");
      return;
    }
    input.removeAttribute("aria-invalid");
    void writeRow(entry.spec.key, input.value, () => api.setSetting(entry.spec.key, input.value));
  });
  if (!zones) return input;
  const wrap = document.createElement("span");
  wrap.append(input, zones);
  return wrap;
}

function selectField(entry: SettingEntry, id: string, options: UiOption[]): HTMLElement {
  const select = document.createElement("select");
  select.className = "setting-select";
  select.id = id;
  // Il valore corrente potrebbe **non essere fra le opzioni**: un
  // `settings.json` scritto a mano, o uno schema che ha cambiato le proprie
  // scelte fra due versioni del plugin. Senza questa riga nessuna `option`
  // risulterebbe scelta e il browser mostrerebbe la prima — cioè un valore
  // falso, che è peggio di un valore strano.
  const current = String(entry.value);
  if (!options.some((o) => o.value === current)) {
    const outside = document.createElement("option");
    outside.value = current;
    outside.textContent = t("settings.off_choices", { value: current });
    outside.selected = true;
    select.append(outside);
  }
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = optionLabel(option);
    el.selected = option.value === entry.value;
    select.append(el);
  }
  select.addEventListener("change", () => {
    void writeRow(entry.spec.key, select.value, () => writeChoice(entry.spec.key, select.value));
  });
  return select;
}

/// Scrive una scelta. Il tema ha un gesto suo — sceglie una luce **della
/// serie**, e con essa il tema di serie — qualunque controllo lo mostri: un
/// valore fuori dalle scelte lo fa cadere in una tendina, e la tendina non deve
/// diventare una strada che salta `selectTheme`.
function writeChoice(key: string, value: string): Promise<void> {
  return key === THEME_KEY
    ? selectTheme(SERIES_THEME_ID, value as "" | "light" | "dark")
    : api.setSetting(key, value);
}

/// La lingua come scelta fra quelle in cui la shell sa parlare, invece di un
/// campo in cui indovinare un tag BCP 47. La chiave resta testo (il kernel
/// accetta `it-CH`): un valore scritto altrove resta visibile come scelta a sé.
function languageField(entry: SettingEntry, id: string): HTMLElement {
  const select = document.createElement("select");
  select.className = "setting-select";
  select.id = id;
  const current = typeof entry.value === "string" ? entry.value : "";
  const options: [string, string][] = [["", t("settings.as_system")]];
  for (const code of catalogLanguages()) options.push([code, endonym(code)]);
  if (!options.some(([value]) => value === current)) {
    options.push([current, t("settings.off_choices", { value: current })]);
  }
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = current;
  select.addEventListener("change", () => {
    void writeRow(entry.spec.key, select.selectedOptions[0]?.textContent ?? select.value, () =>
      api.setSetting(entry.spec.key, select.value),
    );
  });
  return select;
}

/// Il nome di una lingua nella lingua stessa («italiano», «English»): chi ha
/// sbagliato lingua deve riconoscere la propria senza leggere quella sbagliata.
function endonym(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

const TIMEZONE_KEY = "locale.timezone";

/// Le chiavi di testo il cui valore vuoto vuol dire «come il sistema».
const SYSTEM_WHEN_EMPTY = new Set([LANGUAGE_KEY, TIMEZONE_KEY]);

/// I fusi IANA che il motore conosce, come suggerimenti del campo: resta un
/// campo di testo (vuoto è «come il sistema»), ma non va più scritto a memoria.
function timezoneSuggestions(input: HTMLInputElement): HTMLDataListElement | null {
  const zones = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  input.placeholder = t("settings.as_system");
  if (zones.length === 0) return null;
  const list = document.createElement("datalist");
  list.id = `${input.id}-zones`;
  for (const zone of zones) {
    const option = document.createElement("option");
    option.value = zone;
    list.append(option);
  }
  input.setAttribute("list", list.id);
  return list;
}

/// Una scelta breve come segmentato: le opzioni affiancate, la corrente
/// riconoscibile senza aprire niente. Lo decide la forma della scelta
/// (`controlFor`), non la chiave: densità, modalità dell'editor e rientro sono
/// lo stesso dato del tema e si vedono allo stesso modo.
///
/// Le etichette sono quelle che lo schema della Choice porta già dal kernel:
/// l'`option.label` è localizzata là (0040), e ricopiarla qui vorrebbe dire
/// mantenere due traduzioni della stessa frase. Il tema resta l'unico caso con
/// un gesto suo: sceglie la luce della serie, e con un tema installato attivo
/// nessuna delle tre luci è quella corrente.
function segmentedField(entry: SettingEntry, id: string, options: UiOption[]): HTMLElement {
  const current = String(entry.value);
  const customThemeActive = entry.spec.key === THEME_KEY && currentThemeId() !== SERIES_THEME_ID;
  const group = document.createElement("div");
  group.className = "segmented segmented--wide setting-segmented";
  group.id = id;
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", `${id}-label`);
  for (const op of options) {
    const value = op.value;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segmented-option";
    btn.setAttribute("role", "radio");
    btn.textContent = optionLabel(op);
    const selected = !customThemeActive && value === current;
    // `aria-checked` e basta: era accompagnato da una classe modificatrice, e
    // la pelle finiva per elencare quattro selettori diversi per lo stesso
    // acceso, perché nessuno sapeva quale dei quattro il markup usasse.
    btn.setAttribute("aria-checked", String(selected));
    // La scrittura è la stessa della `<select>`: `api.setSetting` con il
    // valore dell'opzione, e `writeRow` che ridisegna con l'esito vicino alla
    // riga. Il reset «azzera» continua a funzionare perché è fuori dal campo.
    btn.dataset.choice = value;
    group.append(btn);
  }
  installRadioGroup(group, (button) => {
    const selectedValue = button.dataset.choice ?? "";
    void writeRow(entry.spec.key, button.textContent || selectedValue, () => writeChoice(entry.spec.key, selectedValue));
  });
  return group;
}

/// Scritture in volo e fallite, per chiave: è ciò che disegna l'esito vicino
/// al controllo (U53) invece di dirlo solo in un toast lontano dalla riga.
///
/// Non sono un bus né uno store: due contenitori di questo pannello, letti da
/// `renderRow`/`renderPermission` e scritti da `writeRow` e dal watcher
/// `setting_changed`. La chiusura le svuota, così una riapertura non ritrova
/// esiti di un vault che non c'è più.
const pendingRows = new Set<string>();

interface RowError {
  message: string;
  input: string;
}

const rowErrors = new Map<string, RowError>();

/// L'esito di una scrittura in volo, vicino al controllo che l'ha chiesta.
///
/// Il testo riusa una chiave esistente via `t()` (nessuna attesa P8): la riga
/// è marcata `aria-busy` e i suoi controlli sono disabilitati, quindi un
/// secondo invio dalla stessa riga non parte con valori catturati vecchi.
/// Le altre righe restano abilitate (blocco minimo).
function rowPending(): HTMLElement {
  const el = row("setting-pending", t("save.saving"));
  el.setAttribute("role", "status");
  return el;
}

/// L'esito di una scrittura fallita, vicino al controllo che l'ha chiesta.
///
/// Il controllo mostra il valore autorevole appena riletto, e qui sotto resta
/// l'input che l'utente aveva provato: nessuno dei due sparisce in un toast.
/// `role="alert"` lo annuncia a chi non guarda lo schermo.
function rowErrorNode(err: RowError): HTMLElement {
  const box = document.createElement("div");
  box.className = "setting-error";
  box.setAttribute("role", "alert");
  box.append(row("setting-error-message", err.message));
  if (err.input !== "") box.append(row("setting-attempted", err.input));
  return box;
}

/// Scrive una riga, e ridisegna: la sourceLabel cambia insieme al valore, e
/// un form che non si ridisegnasse mostrerebbe «valore predefinito» sotto un
/// valore appena scelto.
///
/// `attempted` è l'input che l'utente aveva provato, come lo scriverebbe un
/// umano (`null` dove non c'è un input: azzera): su errore resta sotto la riga
/// mentre il controllo torna al valore autorevole. `failure` è la frase da
/// dire se non è andata: un permesso non cambiato e un'impostazione non
/// cambiata sono due cose diverse per chi legge, e dirle uguali manderebbe a
/// cercare il difetto nella scheda sbagliata.
async function writeRow(
  key: string,
  attempted: string | null,
  action: () => Promise<void>,
  failure: Key = "settings.not_changed",
): Promise<void> {
  // Dove stava guardando l'utente **prima** di disabilitare la riga: il giro
  // di pending toglie il focus dal controllo disabilitato, e senza questa
  // istantanea il giro finale — fotografato a focus già caduto su BODY —
  // non saprebbe dove rimetterlo (A03).
  const snapshot = focusSnapshot();
  pinnedRow = key;
  pendingRows.add(key);
  rowErrors.delete(key);
  // Dopo il gesto che l'ha chiesta, non dentro: un radiogroup attiva e poi
  // sposta il fuoco nello stesso giro, e un bottone disabilitato lì in mezzo
  // perderebbe il fuoco prima di averlo.
  await Promise.resolve();
  if (pendingRows.has(key)) markPending(key);
  try {
    await action();
    rowErrors.delete(key);
  } catch (e) {
    rowErrors.set(key, {
      message: t(failure, { reason: errorText(e) }),
      input: attempted ?? "",
    });
  }
  pendingRows.delete(key);
  await render();
  // Ripara solo ciò che il pending ha rotto: se nel frattempo l'utente si è
  // spostato (o il watcher ha ridisegnato per un'altra chiave), il focus
  // attuale non si tocca.
  if (document.activeElement === document.body) restoreFocus(snapshot);
}

/// Il giro di pending **sulla riga sola**: ridisegnare l'intero pannello per
/// disabilitare un controllo faceva lampeggiare tutto e perdere lo scroll. Il
/// ridisegno completo resta uno, dopo l'esito, perché cambia la provenienza.
function markPending(key: string): void {
  const el = bodyEl.querySelector<HTMLElement>(`[data-setting-key="${key}"]`);
  if (!el) return;
  el.setAttribute("aria-busy", "true");
  el.querySelector(".setting-error")?.remove();
  el.querySelector(".setting-text")?.append(rowPending());
  for (const node of el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
    node.disabled = true;
  }
}

/// Scrive senza una riga (banner dei tasti proposti, catalogo dei temi,
/// registro dei vault): qui non c'è un controllo a cui legare l'esito, e
/// l'errore resta nel toast come prima.
async function write(
  action: () => Promise<void>,
  failure: Key = "settings.not_changed",
): Promise<void> {
  try {
    await action();
  } catch (e) {
    notify(t(failure, { reason: errorText(e) }), "guasto");
  }
  // `render` rimette il focus sullo stesso controllo della stessa riga (A03):
  // qui non si tocca né focus né valori, così l'input successivo resta quello
  // digitato dall'utente.
  await render();
}

/// Dove stava guardando l'utente prima che `write` ricostruisca il corpo.
interface FocusSnapshot {
  controlId: string;
  /// L'opzione di un segmentato, che non ha un id suo.
  choice: string | null;
  rowKey: string | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  scrollTop: number;
}

function focusSnapshot(): FocusSnapshot {
  const focused = document.activeElement;
  return {
    controlId: focused instanceof HTMLElement ? focused.id : "",
    choice: focused instanceof HTMLElement ? focused.dataset.choice ?? null : null,
    rowKey:
      focused instanceof HTMLElement
        ? focused.closest("[data-setting-key]")?.getAttribute("data-setting-key") ?? null
        : null,
    selectionStart:
      focused instanceof HTMLInputElement && focused.type === "text" ? focused.selectionStart : null,
    selectionEnd:
      focused instanceof HTMLInputElement && focused.type === "text" ? focused.selectionEnd : null,
    scrollTop: scrollEl.scrollTop,
  };
}

/// Rimette il focus sullo stesso controllo della stessa riga dopo il rebuild.
function restoreFocus(snapshot: FocusSnapshot): void {
  scrollEl.scrollTop = snapshot.scrollTop;
  if (snapshot.rowKey === null || snapshot.rowKey === "") return;
  const selector = `[data-setting-key="${snapshot.rowKey}"]`;
  const scope = bodyEl.querySelector(selector);
  // Niente `CSS.escape`: gli id contengono punti (`setting-editor.line_numbers`)
  // che in un selettore `#` varrebbero come classi; la ricerca per attributo
  // quotato li tratta come testo.
  // Il ripiego cerca **nel controllo**, non nella riga: nella riga, prima del
  // controllo, c'è «Azzera», e un segmentato appena scelto (le sue opzioni non
  // hanno id) manderebbe il fuoco lì — fuori dal gruppo, a metà delle frecce.
  const choices = [...scope?.querySelectorAll<HTMLElement>("[data-choice]") ?? []];
  const next =
    (snapshot.controlId ? scope?.querySelector<HTMLElement>(`[id="${snapshot.controlId}"]`) : null) ??
    (snapshot.choice !== null ? choices.find((choice) => choice.dataset.choice === snapshot.choice) : null) ??
    scope?.querySelector<HTMLElement>('.setting-control [role="radio"][tabindex="0"]') ??
    scope?.querySelector<HTMLElement>(".setting-control input, .setting-control select, .setting-control button") ??
    scope?.querySelector<HTMLElement>("input, select, button") ??
    null;
  if (next && document.activeElement !== next) next.focus({ preventScroll: true });
  if (
    next instanceof HTMLInputElement &&
    next.type === "text" &&
    snapshot.selectionStart !== null &&
    snapshot.selectionEnd !== null
  ) {
    try {
      next.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    } catch {
      // Un tipo di input che non ammette selezione: il focus basta.
    }
  }
}

// --- la scheda delle scorciatoie (§18.2) ------------------------------------
//
// Questa scheda **non ha un pannello suo**: è la scheda della configurazione con
// un filtro, e disegna le sue righe con la stessa `renderRow` di tutte le
// altre. È la conseguenza di aver deciso che una scorciatoia è una chiave di
// impostazione e non un formato nuovo: il campo di testo, il «vale per questo
// vault» e l'«azzera» ci sono già, e nessuno li ha scritti due volte.

/// **Ciò che il vault propone e nessuno ha guardato** (§23.13), in cima alla
/// scheda: quante sono, su quali comandi, e le due risposte.
///
/// Sta qui e non in un dialogo all'apertura per una ragione che il verbale
/// scrive: un momento di accettazione senza niente da guardare insegna a
/// cliccare «accetto». Qui sotto ci sono le righe vere — la combinazione, la
/// sourceLabel, l'«azzera» — quindi rispondere è una cosa che si fa **dopo**
/// aver visto, e chi non risponde non perde niente: finché non lo fa, quelle
/// combinazioni non premono.
async function drawSuggestedKeys(): Promise<HTMLElement[]> {
  // Il banner è un **di più**, e chi non riesce a dirlo non deve portarsi via la
  // scheda: questa chiamata può fallire per conto suo — nessun vault aperto, o
  // il registro dei vault che non si legge — e da dentro la `Promise.all` di
  // `renderShortcuts` un rifiuto sostituirebbe tutte le scorciatoie con
  // «non si è riusciti a leggere». È lo stesso silenzio di
  // `avvisaSeIlVaultPortaTasti` in `main.ts`, e per la stessa ragione: ciò che
  // si perde è la domanda, non il presidio — le chiavi restano sospese finché
  // qualcuno non risponde.
  const suggested = await api.pendingKeybindings().catch((): Record<string, string> => ({}));
  const keys = Object.keys(suggested);
  if (keys.length === 0) return [];

  const forKey = new Map(allCommands().map((c) => [keybindingKey(c.id), c.title]));
  const box = document.createElement("div");
  box.className = "settings-banner";
  box.append(row("setting-label", t("settings.vault_keys.title", { count: keys.length })));
  box.append(row("muted", t("settings.vault_keys.hint")));
  for (const key of keys) {
    const el = document.createElement("div");
    el.className = "setting-row";
    const text = document.createElement("div");
    text.className = "setting-text";
    const label = document.createElement("label");
    // Il titolo del comando, e la chiave nuda solo se questo montaggio quel
    // comando non ce l'ha. Non dovrebbe capitare — l'host le filtra a chi non è
    // dichiarato — e scriverlo comunque costa una riga e non lascia una casella
    // vuota il giorno che la filtrata cambia.
    label.textContent = forKey.get(key) ?? key;
    text.append(label);
    const kbd = document.createElement("kbd");
    kbd.textContent = suggested[key] ?? "";
    el.append(text, kbd);
    box.append(el);
  }

  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const adoptButton = document.createElement("button");
  adoptButton.className = "primary";
  adoptButton.textContent = t("settings.vault_keys.adopt");
  adoptButton.addEventListener("click", () => void write(() => api.adoptKeybindings()));
  const discardButton = document.createElement("button");
  discardButton.className = "settings-btn";
  discardButton.textContent = t("settings.vault_keys.discard");
  setTooltip(discardButton, t("settings.vault_keys.discard.hint"));
  discardButton.addEventListener("click", () => void write(() => api.discardKeybindings()));
  actions.append(adoptButton, discardButton);
  box.append(actions);
  return [box];
}

function shortcutDiagnostic(command: CommandEntry, binding: string, commands: CommandEntry[]): string {
  const validation = validateKeybinding(binding);
  if (!validation.valid) {
    const descriptions: Record<typeof validation.reason, Key> = {
      "empty-alternative": "settings.shortcut.empty_alternative",
      "too-many": "settings.shortcut.too_many",
      "invalid-chord": "settings.shortcut.invalid_chord",
      duplicate: "settings.shortcut.duplicate",
    };
    return t("settings.shortcut.invalid_unsaved", { reason: t(descriptions[validation.reason]) });
  }
  const proposed = commands.map((item) => item.id === command.id ? { ...item, binding } : item);
  return keybindingIssues(proposed)
    .filter((issue) => issue.type === "invalid"
      ? issue.command.id === command.id
      : issue.type === "shadowed"
        ? issue.short.id === command.id || issue.long.some((other) => other.id === command.id)
        : issue.commands.some((other) => other.id === command.id))
    .map((issue) => issue.type === "collision"
      ? t("settings.shortcut.collision", {
          chord: issue.chord,
          commands: issue.commands.filter((other) => other.id !== command.id).map((other) => other.title).join(", "),
        })
      : issue.type === "shadowed"
        ? t("settings.shortcut.shadowed", {
            command: issue.short.title,
            commands: issue.long.map((other) => other.title).join(", "),
          })
        : t("settings.shortcut.invalid", { binding: issue.binding }))
    .join("; ");
}

async function renderShortcuts(): Promise<HTMLElement[]> {
  const [entries, suggested] = await Promise.all([settings(), drawSuggestedKeys()]);
  const byKey = new Map(entries.map((entry) => [entry.spec.key, entry]));
  const commands = allCommands();
  const nodes: HTMLElement[] = [...suggested, row("muted settings-note", t("settings.shortcuts_hint"))];
  let count = 0;
  const addCommand = (parts: SectionParts, command: CommandEntry, label?: string, description?: string) => {
    const entry = byKey.get(keybindingKey(command.id));
    if (!entry) return;
    const element = renderRow(entry, label, description);
    // La ricerca trova un comando per id, titolo o combinazione: è ciò che si
    // ricorda di una scorciatoia.
    element.dataset.search = normalizeSearch(`${command.id} ${command.title} ${String(entry.value)}`);
    const input = element.querySelector<HTMLInputElement>("input[type=text]");
    const diagnostic = row("setting-source setting-diagnostic", "");
    diagnostic.setAttribute("role", "status");
    if (input) {
      diagnostic.id = `shortcut-issue-${command.id.replace(/[^a-z0-9_-]/gi, "-")}`;
      input.setAttribute("aria-describedby", diagnostic.id);
      const update = () => {
        diagnostic.textContent = shortcutDiagnostic(command, input.value, commands);
        if (validateKeybinding(input.value).valid) input.removeAttribute("aria-invalid");
        else input.setAttribute("aria-invalid", "true");
      };
      input.addEventListener("input", update);
      update();
      element.querySelector(".setting-text")?.append(diagnostic);
    }
    parts.body.append(element);
    count++;
  };
  let index = 0;
  const finish = (parts: SectionParts) => {
    if (parts.body.childElementCount === 0) return;
    markModified(parts, parts.body.querySelectorAll('[data-modified="true"]').length);
    nodes.push(parts.section);
  };
  const declared = sectionBlock(t("settings.shortcuts.declared"), index++);
  for (const command of commands) {
    if (command.spec) addCommand(declared, command);
  }
  finish(declared);
  const fromShell = commands.filter((command) => command.run !== null);
  if (fromShell.length > 0) {
    const shell = sectionBlock(t("settings.shortcuts.shell.title"), index++, { hint: t("settings.shortcuts.shell") });
    for (const command of fromShell) addCommand(shell, command, command.title, command.description);
    finish(shell);
  }
  if (count === 0) nodes.push(row("muted settings-note", t("settings.shortcuts.none")));
  return nodes;
}

// --- la scheda dei componenti -----------------------------------------------

const pendingComponents = new Set<string>();
let componentsGeneration = 0;

async function renderComponents(): Promise<HTMLElement[]> {
  // L'inventario installato non viene ricavato dai bundle runtime: così restano
  // visibili anche una scelta negata, un componente spento e un vault chiuso.
  // Le letture legate al vault sono indipendenti: se non c'è un guest, la loro
  // diagnosi non deve trasformare l'inventario macchina in una scheda vuota.
  const [installedResult, bundleResult, entryResult, budgetResult, limitedResult] = await Promise.allSettled([
    api.listInstalledPlugins(state.vaultRoot || undefined),
    api.listBundles(),
    settings(),
    Promise.resolve().then(() => api.pluginBudgetSnapshot()),
    Promise.resolve().then(() => api.pluginLimitedMode()),
  ]);
  const installed = installedResult.status === "fulfilled" ? installedResult.value : [];
  const bundles = bundleResult.status === "fulfilled" ? bundleResult.value : [];
  const entries = entryResult.status === "fulfilled" ? entryResult.value : [];
  const forKey = new Map(entries.map((entry) => [entry.spec.key, entry]));
  // `runtime_known` è la prova del claim dell'installazione. Un filtro per solo
  // id nasconderebbe invece una feature ufficiale omonima, proprio quando
  // l'installazione è stata rifiutata per collisione.
  const installedRuntimeIds = new Set(
    installed.filter((plugin) => plugin.runtime_known).map((plugin) => plugin.id),
  );
  const native = bundles.filter(
    (bundle) => bundle.kind === "component" && !installedRuntimeIds.has(bundle.id),
  );
  // Lo stato del runtime in poche righe brevi in cima: diagnostica, non
  // contenuto, e non deve pesare quanto i componenti.
  const notes = document.createElement("div");
  notes.className = "settings-note";
  notes.append(row("muted", t("settings.components_hint")));
  const status = document.createElement("div");
  status.className = "settings-status";
  status.setAttribute("aria-label", t("settings.components.runtime"));
  status.setAttribute("role", "group");
  if (limitedResult.status === "fulfilled") {
    status.append(row("setting-source", limitedResult.value.enabled
      ? t("settings.components.limited_on", { reason: limitedResult.value.reason ?? t("settings.components.limited_default") })
      : t("settings.components.limited_off")));
  } else status.append(row("setting-source", t("settings.components.limited_unavailable", { reason: errorText(limitedResult.reason) })));
  if (budgetResult.status === "fulfilled") {
    const b = budgetResult.value;
    status.append(row("setting-source", t("settings.components.budget", {
      live: b.live_instances, calls: b.total_calls, timeouts: b.timed_out_calls, oom: b.oom_calls,
    })));
  } else status.append(row("setting-source", t("settings.components.budget_unavailable", { reason: errorText(budgetResult.reason) })));
  if (bundleResult.status === "rejected") {
    status.append(row("setting-source", t("settings.read_failed", { reason: errorText(bundleResult.reason) })));
  }
  if (entryResult.status === "rejected") {
    status.append(row("setting-source", t("settings.read_failed", { reason: errorText(entryResult.reason) })));
  }
  notes.append(status);
  const nodes: HTMLElement[] = [notes];
  let index = 0;

  const add = sectionBlock(t("settings.components.add"), index++, { card: false });
  const installCard = document.createElement("div");
  installCard.className = "settings-card";
  installCard.append(installAction());
  add.body.append(installCard, renderCatalogSearch(installed));
  nodes.push(add.section);

  if (native.length > 0) {
    const bundled = sectionBlock(t("settings.components.bundled"), index++, { card: false });
    for (const bundle of native) bundled.body.append(renderComponent(bundle, forKey));
    nodes.push(bundled.section);
  }

  const mine = sectionBlock(t("settings.components.installed"), index++, { card: false });
  if (installedResult.status === "rejected") {
    mine.body.append(row("muted settings-note", t("settings.read_failed", { reason: errorText(installedResult.reason) })));
  } else if (installed.length === 0) {
    mine.body.append(row("muted settings-note", t("settings.components.installed.none")));
  } else {
    for (const plugin of installed) mine.body.append(renderInstalledComponent(plugin, forKey));
  }
  nodes.push(mine.section);
  return nodes;
}

function renderCatalogSearch(installed: InstalledPluginInfo[]): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "settings-card settings-catalog";
  const head = document.createElement("div");
  head.className = "setting-row setting-block";
  blockHead(head, t("settings.catalog.title"), t("settings.catalog.hint"));
  panel.append(head);
  const search = document.createElement("input");
  search.type = "search";
  search.className = "setting-input";
  search.placeholder = t("settings.catalog.search_placeholder");
  search.setAttribute("aria-label", t("settings.catalog.search"));
  const run = document.createElement("button");
  run.type = "button";
  run.className = "settings-btn";
  run.textContent = t("settings.catalog.run");
  const status = row("setting-source", "");
  status.setAttribute("role", "status");
  const results = document.createElement("div");
  results.className = "settings-catalog-results";
  const generation = componentsGeneration;
  let request = 0;
  run.addEventListener("click", () => {
    const mine = ++request;
    run.disabled = true;
    status.textContent = t("settings.catalog.checking");
    void Promise.resolve().then(() => api.catalogSearch(search.value)).then((entries) => {
      if (generation !== componentsGeneration || mine !== request || !panel.isConnected) return;
      results.replaceChildren(...entries.map((entry) => renderCatalogEntry(entry, installed)));
      status.textContent = t("settings.catalog.count", { count: entries.length });
    }).catch((error: unknown) => {
      if (generation === componentsGeneration && mine === request && panel.isConnected) {
        status.textContent = t("settings.catalog.unavailable", { reason: errorText(error) });
      }
    }).finally(() => {
      if (generation === componentsGeneration && mine === request) run.disabled = false;
    });
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); run.click(); }
  });
  const form = document.createElement("div");
  form.className = "settings-actions";
  form.append(search, run);
  head.append(form, status);
  panel.append(results);
  return panel;
}

function renderCatalogEntry(entry: CatalogEntry, installed: InstalledPluginInfo[]): HTMLElement {
  const item = document.createElement("section");
  item.className = "setting-row";
  const details = document.createElement("div");
  details.className = "setting-text";
  details.append(
    row("setting-label", `${entry.name} · ${entry.version} · ${entry.kind}`),
    row("setting-source", t("settings.catalog.provenance", { publisher: entry.provenance, license: entry.license, compatible: String(entry.compatible) })),
    row("setting-source", t("settings.catalog.digest", { digest: entry.digest, size: String(entry.size), abi: String(entry.abi) })),
    row("setting-source", entry.revoked
      ? t("settings.catalog.revoked")
      : t("settings.catalog.permissions", { permissions: entry.permissions.join(", ") || t("settings.catalog.no_permissions") })),
  );
  item.append(details);
  const buttons = document.createElement("div");
  buttons.className = "setting-control settings-actions";
  item.append(buttons);
  const current = installed.find((plugin) => plugin.id === entry.id);
  const action = (label: string, operation: (source: string) => Promise<unknown>, requiresSource = true, danger = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = danger ? "settings-btn settings-btn--danger" : "settings-btn";
    button.textContent = label;
    button.addEventListener("click", () => {
      const generation = componentsGeneration;
      button.disabled = true;
      void (async () => {
        const accepted = await confirm(t(entry.revoked ? "settings.catalog.confirm_revoked" : "settings.catalog.confirm", { action: label, name: entry.name, version: entry.version, publisher: entry.provenance, license: entry.license, digest: entry.digest }), {
          title: label, okLabel: label, danger,
        });
        if (!accepted || generation !== componentsGeneration || !item.isConnected) return;
        const source = requiresSource
          ? entry.kind === "theme" ? await pickFolder() : await pickFile()
          : "";
        if (requiresSource && source === null) return;
        if (generation !== componentsGeneration || !item.isConnected) return;
        await completeComponentAction(`catalog:${entry.id}`, [item],
          () => operation(source ?? ""), "settings.component_not_changed");
      })().catch((error: unknown) =>
        notify(t("settings.catalog.failed", { reason: errorText(error) }), "guasto"))
        .finally(() => { if (item.isConnected) button.disabled = false; });
    });
    buttons.append(button);
  };
  if (!entry.revoked) {
    if (entry.kind === "plugin") {
      if (!current) action(t("settings.catalog.install"), (source) => api.catalogInstall(entry.id, entry.version, source));
      else {
        action(t("settings.catalog.update"), (source) => api.catalogUpdate(current.installation, entry.version, source));
        action(t("settings.catalog.rollback"), (source) => api.catalogRollback(current.installation, entry.version, source));
      }
    } else {
      action(t("settings.catalog.install_theme"), (source) => api.catalogInstallTheme(entry.id, entry.version, source));
      action(t("settings.catalog.update_theme"), (source) => api.catalogUpdateTheme(entry.id, entry.version, source));
      action(t("settings.catalog.rollback_theme"), (source) => api.catalogRollbackTheme(entry.id, entry.version, source));
    }
  } else if (entry.kind === "plugin" && current) {
    action(t("settings.catalog.revoke"), () => api.catalogRevoke(current.installation), false, true);
  } else if (entry.kind === "theme") {
    action(t("settings.catalog.revoke_theme"), () => api.catalogRevokeTheme(entry.id), false, true);
  }
  return item;
}

function installAction(): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("div");
  label.className = "setting-label";
  label.textContent = t("settings.components.install");
  text.append(label, row("muted", t("settings.components.install.hint")));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-btn";
  button.textContent = t("settings.components.install.pick");
  button.disabled = pendingComponents.has("install");
  button.addEventListener("click", () => {
    if (pendingComponents.has("install")) return;
    const generation = componentsGeneration;
    pendingComponents.add("install");
    setPending([el], true);
    void (async () => {
      const path = await pickFile().catch((error: unknown) => {
        notify(t("settings.components.install_failed", { reason: errorText(error) }), "guasto");
        return null;
      });
      if (
        path === null ||
        generation !== componentsGeneration ||
        release === null ||
        panelEl.hidden ||
        tab !== "components"
      ) {
        pendingComponents.delete("install");
        if (generation === componentsGeneration && el.isConnected) await render();
        return;
      }
      await completeComponentAction(
        "install",
        [el],
        () => api.installPlugin(path),
        "settings.components.install_failed",
      );
    })();
  });
  const control = document.createElement("div");
  control.className = "setting-control";
  control.append(button);
  el.append(text, control);
  return el;
}

/// I riquadri aperti, per chiave: il corpo si ridisegna intero a ogni
/// scrittura e a ogni `setting_changed`, e un riquadro che si richiude da solo
/// porta via il controllo appena usato, il suo esito e il fuoco. La chiusura del
/// pannello li dimentica.
const openDetails = new Set<string>();

/// Un riquadro che si apre e che ricorda di essere aperto. `force` lo apre
/// comunque: una riga dentro che sta scrivendo, o che ha fallito, deve restare
/// in vista col suo esito.
function openableDetails(key: string, summaryText: string, force = false): { details: HTMLDetailsElement; body: HTMLElement } {
  const details = document.createElement("details");
  details.className = "settings-details";
  details.dataset.detailsKey = key;
  details.open = force || openDetails.has(key);
  if (details.open) openDetails.add(key);
  const summary = document.createElement("summary");
  summary.textContent = summaryText;
  const body = document.createElement("div");
  body.className = "settings-details-body";
  details.append(summary, body);
  details.addEventListener("toggle", () => {
    if (details.open) openDetails.add(key);
    else openDetails.delete(key);
  });
  return { details, body };
}

/// I permessi di un componente in un riquadro che si apre: il sommario dice
/// quanti sono, così un componente che chiede molto si riconosce senza aprirlo.
function permissionDetails(
  key: string,
  permissions: PermissionRow[],
  hints: string[],
  draw: (permission: PermissionRow) => HTMLElement,
): HTMLElement {
  if (permissions.length === 0) return row("muted setting-component-note", t("settings.permissions.none"));
  const busy = permissions.some((permission) => pendingRows.has(permission.key) || rowErrors.has(permission.key));
  const { details, body: inside } = openableDetails(
    `permissions:${key}`,
    plural(permissions.length, "settings.components.permissions.count.one", "settings.components.permissions.count"),
    busy,
  );
  for (const hint of hints) inside.append(row("muted", hint));
  for (const permission of permissions) inside.append(draw(permission));
  return details;
}

/// Un componente distribuito con Fub conserva il proprio interruttore runtime e
/// le preferenze granulari dei permessi. Il percorso installato sotto è
/// separato: l'autorità persistita è l'identità dell'installazione.
function renderComponent(bundle: BundleInfo, forKey: EntryMap): HTMLElement {
  const card = document.createElement("div");
  card.className = "settings-card settings-component";
  const el = document.createElement("div");
  el.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = bundle.name;
  label.htmlFor = `bundle-${bundle.id}`;
  text.append(label, row("muted", `${bundle.id} · ${t(TRUST_LABELS[bundle.trust])}`));
  const input = switchInput(`bundle-${bundle.id}`, bundle.mounted);
  const pendingKey = `bundle:${bundle.id}`;
  input.disabled = pendingComponents.has(pendingKey);
  input.addEventListener("change", () => {
    beginComponentAction(
      pendingKey,
      [card],
      () => api.setPluginEnabled(bundle.id, input.checked),
      "settings.component_not_changed",
    );
  });
  const control = document.createElement("div");
  control.className = "setting-control";
  control.append(input);
  el.append(text, control);
  card.append(el);

  const hints = [t("settings.permissions.hint")];
  if (!bundle.mounted) hints.push(t("settings.permissions.off_hint"));
  card.append(permissionDetails(`bundle:${bundle.id}`, rows(bundle), hints, (permission) => renderPermission(permission, forKey.get(permission.key))));
  return card;
}

const CONSENT_LABELS: Record<InstalledPluginInfo["consent"], Key> = {
  undecided: "settings.components.consent.undecided",
  denied: "settings.components.consent.denied",
  granted: "settings.components.consent.granted",
};

function renderInstalledComponent(plugin: InstalledPluginInfo, forKey: EntryMap): HTMLElement {
  const key = `installed:${plugin.installation}`;
  const pending = pendingComponents.has(key);
  const card = document.createElement("div");
  card.className = "settings-card settings-component";
  const nodes = [card];

  const header = document.createElement("div");
  header.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const name = document.createElement("div");
  name.className = "setting-label";
  name.setAttribute("role", "heading");
  name.setAttribute("aria-level", "4");
  name.textContent = plugin.name;
  text.append(
    name,
    row(
      "muted",
      t("settings.components.identity", {
        id: plugin.id,
        version: plugin.version,
        trust: t(TRUST_LABELS[plugin.trust]),
      }),
    ),
    row(
      "setting-source",
      t(plugin.mounted ? "settings.components.runtime.mounted" : "settings.components.runtime.off"),
    ),
  );
  if (plugin.catalog) text.append(
    row("setting-source", t("settings.components.signed", {
      key: plugin.catalog.key_id,
      generation: plugin.catalog.generation,
      publisher: plugin.catalog.publisher,
      license: plugin.catalog.license,
      compatible: plugin.catalog.compatible,
      url: plugin.catalog.url,
    })),
  );
  if (plugin.revoked) text.append(
    row("setting-source", plugin.revocation
      ? t("settings.components.revoked_signed", { key: plugin.revocation.key_id, generation: plugin.revocation.generation })
      : t("settings.components.revoked")),
  );
  header.append(text);
  card.append(header);

  const enabledRow = document.createElement("div");
  enabledRow.className = "setting-row";
  const enabledText = document.createElement("div");
  enabledText.className = "setting-text";
  const enabledLabel = document.createElement("label");
  const enabledId = `installed-enabled-${plugin.installation}`;
  enabledLabel.htmlFor = enabledId;
  enabledLabel.textContent = t("settings.components.enabled");
  enabledText.append(enabledLabel, row("muted", t("settings.components.enabled.hint")));
  const enabled = switchInput(enabledId, plugin.enabled);
  enabled.disabled = pending || plugin.revoked;
  enabled.addEventListener("change", () => {
    beginComponentAction(
      key,
      nodes,
      () => api.setInstalledPluginEnabled(plugin.installation, enabled.checked),
      "settings.components.enabled_failed",
    );
  });
  const enabledControl = document.createElement("div");
  enabledControl.className = "setting-control";
  enabledControl.append(enabled);
  enabledRow.append(enabledText, enabledControl);
  card.append(enabledRow);

  const consentRow = document.createElement("div");
  consentRow.className = "setting-row";
  const consentText = document.createElement("div");
  consentText.className = "setting-text";
  const consentLabel = document.createElement("label");
  const consentId = `installed-consent-${plugin.installation}`;
  consentLabel.htmlFor = consentId;
  consentLabel.textContent = t("settings.components.consent");
  consentText.append(consentLabel, row("muted", t("settings.components.consent.hint")));
  const consent = document.createElement("select");
  consent.className = "setting-select";
  consent.id = consentId;
  consent.disabled = pending;
  for (const value of ["undecided", "denied", "granted"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(CONSENT_LABELS[value]);
    option.selected = value === plugin.consent;
    consent.append(option);
  }
  consent.addEventListener("change", () => {
    const next = consent.value as InstalledPluginInfo["consent"];
    const apply = () => beginComponentAction(
      key,
      nodes,
      () => api.setInstalledPluginConsent(plugin.installation, next),
      "settings.components.consent_failed",
    );
    if (next !== "granted") {
      apply();
      return;
    }
    // Il consenso è il momento in cui il componente ottiene i suoi permessi:
    // li si legge lì, nella domanda, e non solo nell'elenco sotto la riga.
    const asked = rows(plugin).map((permission) =>
      permission.detail ? `• ${permission.message} (${permission.detail})` : `• ${permission.message}`);
    void confirm(
      t("settings.components.consent.confirm", {
        name: plugin.name,
        permissions: asked.length > 0 ? asked.join("\n") : t("settings.permissions.none"),
      }),
      { title: t("settings.components.consent.confirm_title"), okLabel: t("settings.components.consent.grant") },
    ).then((accepted) => {
      if (accepted && consent.isConnected) apply();
      else consent.value = plugin.consent;
    }, () => { consent.value = plugin.consent; });
  });
  const consentControl = document.createElement("div");
  consentControl.className = "setting-control";
  consentControl.append(consent);
  consentRow.append(consentText, consentControl);
  card.append(consentRow);

  card.append(permissionDetails(
    `installed:${plugin.installation}`,
    rows(plugin),
    [t("settings.components.permissions.hint")],
    (permission) => renderPermission(permission, plugin.runtime_known ? forKey.get(permission.key) : undefined),
  ));

  const removeRow = document.createElement("div");
  removeRow.className = "setting-row";
  const removeText = document.createElement("div");
  removeText.className = "setting-text";
  const removeLabel = document.createElement("div");
  removeLabel.className = "setting-label";
  removeLabel.textContent = t("settings.components.remove");
  removeText.append(removeLabel, row("muted", t("settings.components.remove.hint")));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "settings-btn settings-btn--danger";
  remove.textContent = t("settings.components.remove");
  remove.disabled = pending || plugin.enabled;
  if (plugin.enabled) {
    remove.setAttribute("aria-describedby", `installed-remove-hint-${plugin.installation}`);
    const disabledHint = row("setting-source", t("settings.components.remove.disabled"));
    disabledHint.id = `installed-remove-hint-${plugin.installation}`;
    removeText.append(disabledHint);
  }
  remove.addEventListener("click", () => {
    if (plugin.enabled || pendingComponents.has(key)) return;
    pendingComponents.add(key);
    setPending(nodes, true);
    void (async () => {
      const accepted = await confirm(t("settings.components.remove.confirm", { name: plugin.name }), {
        title: t("settings.components.remove.title"),
        okLabel: t("settings.components.remove"),
        danger: true,
      }).catch((error: unknown) => {
        notify(t("settings.components.remove_failed", { reason: errorText(error) }), "guasto");
        return false;
      });
      if (!accepted || !remove.isConnected || tab !== "components" || release === null) {
        pendingComponents.delete(key);
        if (remove.isConnected && release !== null && tab === "components") await render();
        return;
      }
      await completeComponentAction(
        key,
        nodes,
        () => api.removeInstalledPlugin(plugin.installation),
        "settings.components.remove_failed",
      );
    })();
  });
  const removeControl = document.createElement("div");
  removeControl.className = "setting-control";
  removeControl.append(remove);
  removeRow.append(removeText, removeControl);
  card.append(removeRow);
  if (pending) card.setAttribute("aria-busy", "true");
  return card;
}

function beginComponentAction(
  key: string,
  nodes: HTMLElement[],
  action: () => Promise<unknown>,
  failure: Key,
): void {
  if (pendingComponents.has(key)) return;
  pendingComponents.add(key);
  setPending(nodes, true);
  void completeComponentAction(key, nodes, action, failure);
}

async function completeComponentAction(
  key: string,
  nodes: HTMLElement[],
  action: () => Promise<unknown>,
  failure: Key,
): Promise<void> {
  try {
    const result = await action();
    const diagnostics = Array.isArray(result)
      ? result
      : result && typeof result === "object" && "diagnostics" in result && Array.isArray(result.diagnostics)
        ? result.diagnostics
        : [];
    for (const diagnostic of diagnostics) notify(errorText(diagnostic), "guasto");
  } catch (error) {
    notify(t(failure, { reason: errorText(error) }), "guasto");
  }
  try {
    await settingsHooks.reloadProvider();
  } catch (error) {
    notify(t("settings.components.reload_failed", { reason: errorText(error) }), "guasto");
  }
  pendingComponents.delete(key);
  if (release !== null && !panelEl.hidden && tab === "components") {
    await render();
  } else {
    setPending(nodes, false);
  }
}

function setPending(nodes: HTMLElement[], pending: boolean): void {
  for (const node of nodes) {
    node.setAttribute("aria-busy", String(pending));
    for (const control of node.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      "input, select, button",
    )) {
      control.disabled = pending;
    }
  }
}

/// Una riga di permesso: la frase, il suo parametro e l'interruttore granulare
/// quando l'owner runtime corrisponde e la relativa impostazione esiste.
function renderPermission(p: PermissionRow, entry: SettingEntry | undefined): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row setting-permission";
  // Stessa identità delle righe di configurazione: il watcher `setting_changed`
  // cancella l'errore per chiave, e il focus torna qui (A03).
  el.dataset.settingKey = p.key;
  const text = document.createElement("div");
  text.className = "setting-text";
  const interactive = entry !== undefined && p.known;
  const description = document.createElement(interactive ? "label" : "div");
  description.textContent = p.message;
  if (interactive) (description as HTMLLabelElement).htmlFor = `permission-${p.key}`;
  text.append(description);
  if (p.detail) text.append(row("setting-source", p.detail));
  el.append(text);

  if (!p.known || !entry) return el;
  const pending = pendingRows.has(p.key);
  const failure = rowErrors.get(p.key);
  if (pending) el.setAttribute("aria-busy", "true");

  const granted = entry.value !== false;
  const input = switchInput(`permission-${p.key}`, granted);
  input.setAttribute("aria-label", t("settings.permission.grant", { cosa: p.message }));
  input.addEventListener("change", () => {
    void writeRow(p.key, show(input.checked), () => api.setSetting(p.key, input.checked), "settings.permission_not_changed");
  });
  const control = document.createElement("div");
  control.className = "setting-control";
  control.append(input);
  el.append(control);
  if (pending) {
    text.append(rowPending());
    input.disabled = true;
  } else if (failure) text.append(rowErrorNode(failure));
  if (!granted) text.append(row("setting-source", t("settings.permission.denied")));
  return el;
}

// --- la scheda dei vault conosciuti -----------------------------------------

async function renderVault(): Promise<HTMLElement[]> {
  const vaults = await api.knownVaults();
  if (vaults.length === 0) {
    return [row("muted settings-note", t("settings.no_vaults"))];
  }
  const card = document.createElement("div");
  card.className = "settings-card";
  card.append(...vaults.map(renderVaultRow));
  return [card];
}

function renderVaultRow(vault: KnownVault): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row settings-vault";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("div");
  label.className = "setting-label";
  // Il nome vuoto è il nome della cartella, e lo ricava chi disegna: tenerlo
  // scritto vorrebbe dire mostrare il nome vecchio dopo una rinomina.
  label.textContent = `${vault.icon ?? ""} ${vault.name || nameFolder(vault.root)}`.trim();
  const path = row("muted setting-path", vault.root);
  text.append(label, path);

  const open = document.createElement("button");
  open.type = "button";
  open.className = "settings-btn";
  open.textContent = t("settings.open");
  open.addEventListener("click", () => {
    void (async () => {
      try {
        // La strada è **quella di `main.ts`** e non un `openVault` seguito da
        // un reload: ricaricare rimette la shell nello stato iniziale, e lo
        // stato iniziale si ricostruisce da `FUB_VAULT` — che quasi sempre
        // non c'è. Il backend avrebbe il vault aperto e la finestra sarebbe
        // vuota, senza nemmeno un modo di dirlo.
        await settingsHooks.openVault(vault.root);
        close();
      } catch (e) {
        notify(t("settings.open_failed", { reason: errorText(e) }), "guasto");
      }
    })();
  });

  // Il preferito è un pulsante a due stati: `aria-pressed` lo dice a chi
  // ascolta, la stella piena o vuota a chi guarda.
  const favoriteButton = document.createElement("button");
  favoriteButton.type = "button";
  favoriteButton.className = "settings-star";
  favoriteButton.textContent = vault.favorite ? "★" : "☆";
  favoriteButton.setAttribute("aria-pressed", String(vault.favorite));
  favoriteButton.setAttribute("aria-label", t("settings.favourite.label"));
  setTooltip(favoriteButton, t(vault.favorite ? "settings.unfavourite" : "settings.favourite"));
  favoriteButton.addEventListener("click", () => {
    void writeVault(() => api.setVaultFavorite(vault.root, !vault.favorite));
  });

  const forget = document.createElement("button");
  forget.type = "button";
  forget.className = "link-button";
  forget.textContent = t("settings.forget");
  setTooltip(forget, t("settings.forget.hint"));
  forget.addEventListener("click", () => {
    void writeVault(() => api.forgetVault(vault.root));
  });

  const actions = document.createElement("div");
  actions.className = "setting-control settings-actions";
  actions.append(favoriteButton, open, forget);
  el.append(text, actions);
  return el;
}

async function writeVault(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (e) {
    notify(t("settings.registry_failed", { reason: errorText(e) }), "guasto");
  }
  await render();
}

function nameFolder(root: string): string {
  const parts = root.split(/[\\/]/).filter((p) => p !== "");
  return parts[parts.length - 1] ?? root;
}

function row(className: string, text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}
