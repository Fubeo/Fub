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
//
// # In più file
//
// Qui restano lo stato del pannello, l'apertura, il disegno delle schede, i
// filtri e le scritture. Le parti stanno accanto: `settings-form.ts` (il
// modulo, i profili, il catalogo dei temi), `settings-fields.ts` (una riga e i
// suoi campi), `settings-shortcuts.ts`, `settings-components.ts` e
// `settings-vault.ts` (le altre schede). Le esportazioni in più di questo
// modulo servono a quelle parti, non al resto della shell; nessuna parte
// assegna lo stato di qui, e nessuna lo legge al caricamento.

import { Race } from "../ui/race";
import { settings } from "../host/query";
import type { SettingEntry } from "../host/contract";
import { onEvent } from "../state/kernel";
import { on } from "../state/store";
import { $ } from "../ui/dom";
import { trapFocus } from "../ui/a11y";
import { notify } from "../ui/notify";
import { allCommands, keybindingKey, registerComponentRow } from "../ui/commands";
import { isPermissionKey } from "../ui/permissions";
import { errorText } from "../host/errors";
import { onLanguage, plural, t, type Key } from "../i18n/strings";
import { cancelThemePreview } from "../theme/theme";
import { setTooltip } from "../ui/tooltip";
import { mountComponentsPage, type ComponentsPage } from "./components-page";
import { enterSurface, exitSurface } from "../ui/motion";
import { icon } from "../ui/icons";
import { mountUpdateCheck, type UpdateChecker } from "./about";
import { reducedMotion } from "../theme/reduced-motion";
import { cancelCssSnippetsPreview } from "../theme/snippets";
import { openLifetime, type Lifetime, type Teardown } from "../ui/lifetime";
import { isModified, matchesTerms, searchTerms, sectionAnchor } from "./settings-model";
import { dimenticaTastiDisegno } from "./settings-disegno";
import { dimenticaMotore } from "./settings-motore";
import { openDetails, renderComponents } from "./settings-components";
import { renderAbout, renderVault, row } from "./settings-vault";
import {
  MANAGED_ELSEWHERE,
  WHOLE_FORM_KEYS,
  groupReset,
  renderForm,
  renderFormRow,
} from "./settings-form";
import { renderShortcuts } from "./settings-shortcuts";
import { loadOwnListFields, renderRow } from "./settings-fields";

/// Le righe risolte per chiave: è ciò con cui una scheda ritrova il valore di
/// una chiave che ha composto invece di leggerla da un elenco.
export type EntryMap = Map<string, SettingEntry>;

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
export let panelEl: HTMLElement;

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

export let settingsHooks: Hooks;

/// Le schede che questo pannello ospita. `views` è la superficie
/// `settings_tab` del contratto (§2.2): la dichiarano le view, e finora questa
/// shell non aveva dove metterle.
type SettingsTab = "settings" | "components" | "shortcuts" | "vault" | "about";

/// La figura di ogni scheda nella colonna di navigazione.
const TAB_ICONS: Record<SettingsTab, string> = {
  settings: "settings",
  components: "component",
  shortcuts: "keyboard",
  vault: "vault",
  about: "info",
};

export let tab: SettingsTab = "settings";

/// La scheda dell'ultimo disegno: cambiarla riporta lo scroll in cima, un
/// ridisegno della stessa lo conserva.
let renderedTab: SettingsTab | null = null;

/// La sezione scelta con un clic nell'indice. Resta la voce attiva finché chi
/// legge non scorre di suo: lo scorrimento che il clic avvia non può portare
/// in cima le sezioni dell'ultimo schermo, e l'osservatore ne sceglierebbe
/// un'altra.
let chosenSection: string | null = null;

/// I tasti con cui si scorre il corpo da tastiera.
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

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
export function installRadioGroup(
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
export function settleRadioGroup(group: HTMLElement): void {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
  const enabled = buttons.filter((button) => !button.disabled);
  const checked = enabled.find((button) => button.getAttribute("aria-checked") === "true");
  const tabbable = checked ?? enabled[0];
  for (const button of buttons) button.tabIndex = button === tabbable ? 0 : -1;
}

function selectTab(next: SettingsTab, focus: boolean): void {
  const owner = settingsLifetime;
  void changeTab(next).then(() => {
    if (!focus || owner?.closed || owner !== settingsLifetime) return;
    tabButtons().find((button) => button.dataset.tab === next)?.focus();
  });
}

/// Passa alla scheda `next` e la disegna: lascia l'anteprima del tema se si
/// esce dalla configurazione, e la riga tenuta in vista non vale più.
function changeTab(next: SettingsTab): Promise<void> {
  if (tab === "settings" && next !== "settings") {
    void cancelThemePreview();
    cancelCssSnippetsPreview();
  }
  tab = next;
  pinnedRow = null;
  componentsGeneration++;
  syncToolbar();
  return render();
}

/// **Apre le Impostazioni su una voce** (`files.attachment-folder` per
/// «Cambia cartella» della lavagna): le apre come `#open-settings`, sceglie la
/// scheda dove la voce sta, la tiene in vista anche sotto un filtro
/// (`pinnedRow`), la scorre in vista e dà il fuoco al suo campo. Una chiave che
/// il vault non ha apre le Impostazioni e basta; con le Impostazioni già
/// aperte cambia soltanto scheda e riga.
export async function revealSetting(key: string): Promise<void> {
  const owner = settingsLifetime;
  if (!owner || owner.closed) return;
  const entries = await settings().catch((): SettingEntry[] => []);
  if (owner.closed || owner !== settingsLifetime) return;
  const where = entries.some((entry) => entry.spec.key === key) ? tabOfSetting(key) : null;
  if (!release) {
    // Chiuse: la scheda giusta si sceglie prima di aprire, così il primo
    // disegno è già quello (l'anteprima del tema è caduta con la chiusura).
    if (where !== null && where !== tab) {
      tab = where;
      componentsGeneration++;
    }
    if (where !== null) pinnedRow = key;
    await open();
  } else if (where !== null && where !== tab) {
    await changeTab(where);
  }
  if (where === null || owner.closed || owner !== settingsLifetime || tab !== where) return;
  pinnedRow = key;
  applyFilter();
  const item = bodyEl.querySelector<HTMLElement>(`[data-setting-key="${CSS.escape(key)}"]`);
  if (!item) return;
  const details = item.closest("details");
  if (details) details.open = true;
  item.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  const field = item.querySelector<HTMLElement>(`[id="setting-${CSS.escape(key)}"]`)
    ?? item.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
  field?.focus({ preventScroll: true });
}

/// La scheda che disegna la voce `key`: i permessi stanno coi componenti, le
/// scorciatoie nella loro scheda, il resto nella configurazione (lo stesso
/// conto di `renderForm`).
function tabOfSetting(key: string): SettingsTab {
  if (isPermissionKey(key)) return "components";
  if (allCommands().some((command) => keybindingKey(command.id) === key)) return "shortcuts";
  return "settings";
}

/// Apre le impostazioni sulla riga del componente `id` nella scheda
/// «Componenti» (la porta `showComponent`, per «Accendi…» del disegno). Il
/// pannello già aperto cambia scheda come col clic; chiuso si apre su quella
/// scheda. Un `id` che la mappa non ha apre la scheda e basta; un pannello
/// chiuso prima che la riga arrivi non si riapre.
async function openComponentRow(id: string): Promise<void> {
  const owner = settingsLifetime;
  if (!owner || owner.closed) return;
  if (release) {
    if (tab !== "components") await changeTab("components");
  } else {
    if (tab !== "components") {
      tab = "components";
      pinnedRow = null;
      componentsGeneration++;
      syncToolbar();
    }
    await open();
  }
  if (owner.closed || owner !== settingsLifetime || !release || tab !== "components") return;
  await componentsPage.focusRow(id);
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
  updateChecker = mountUpdateCheck(lifetime, () => {
    if (tab === "about") void render();
  });

  tab = "settings";
  renderedTab = null;
  renderedForm = null;
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
    lifetime.listen(button, "click", () => void selectTab(value, true));
    lifetime.listen(button, "keydown", (event) => {
      const buttons = tabButtons();
      const index = buttons.indexOf(button);
      const next = moveTab(index, event.key, buttons.length);
      if (next === null) return;
      event.preventDefault();
      const nextTab = buttons[next]?.dataset.tab as SettingsTab | undefined;
      if (nextTab) void selectTab(nextTab, true);
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
      chosenSection = null;
      filters[tab].query = field.value;
      scrollEl.scrollTop = 0;
      applyFilter();
    });
  }
  if (modifiedEl) {
    lifetime.listen(modifiedEl, "click", () => {
      if (!isFilterable(tab)) return;
      pinnedRow = null;
      chosenSection = null;
      filters[tab].modified = !filters[tab].modified;
      scrollEl.scrollTop = 0;
      syncToolbar();
      applyFilter();
    });
  }
  lifetime.listen(scrollEl, "scroll", () => updateTocCurrent());
  // Chi scorre di suo (rotella, dito, barra, tasti) riprende la voce attiva
  // dalla posizione, anche se in fondo lo scorrimento non si muove più.
  const ownScroll = (): void => {
    if (chosenSection === null) return;
    chosenSection = null;
    updateTocCurrent();
  };
  lifetime.listen(scrollEl, "wheel", ownScroll, { passive: true });
  lifetime.listen(scrollEl, "touchmove", ownScroll, { passive: true });
  lifetime.listen(scrollEl, "pointerdown", (event) => {
    if (event.target === scrollEl) ownScroll();
  });
  lifetime.listen(scrollEl, "keydown", (event) => {
    if (!SCROLL_KEYS.has(event.key)) return;
    // I tasti di un controllo sono del controllo, non dello scorrimento.
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, button, [contenteditable]") || target?.matches("[role]")) return;
    ownScroll();
  });
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
  //
  // Una chiave che ha una scrittura in volo da una riga di qui la ridisegna
  // quella scrittura, al suo esito: l'evento che la scrittura stessa provoca
  // sarebbe un secondo aggiornamento uguale.
  const stopSetting = onEvent("setting_changed", (event) => {
    rowErrors.delete(event.key);
    if (lifetime.closed || panelEl.hidden) return;
    if (typeof event.key === "string" && pendingRows.has(event.key)) return;
    void refresh(event.key);
  });
  if (typeof stopSetting === "function") lifetime.add(stopSetting);
  // Il tema collegato si rimonta a ogni salvataggio dell'autore: la riga
  // «Ricaricato alle…» e la diagnosi si ridisegnano con lui.
  lifetime.add(on("theme-link", () => {
    if (!lifetime.closed && !panelEl.hidden) void render();
  }));
  // Quali campi ha toccato chi scrive: solo quelli possono avere una bozza da
  // portare oltre il ridisegno (#401).
  lifetime.listen(bodyEl, "input", (event) => {
    if (isDraftControl(event.target)) typedControls.add(event.target);
    forgetRowError(event.target);
  });
  // Chromium, togliendo dal documento il campo che ha il fuoco, gli manda
  // `blur` e con esso il `change` di una casella modificata: il ridisegno per
  // un'altra chiave salvava così da solo il testo a metà. Quello non è un
  // gesto di chi scrive, e la bozza resta bozza; in cattura, prima del campo.
  lifetime.listen(bodyEl, "change", (event) => {
    if (replacingBody) event.stopImmediatePropagation();
  }, { capture: true });
  // Chiudere il vault mentre il pannello è aperto lascerebbe un form che parla
  // di un vault che non c'è: le impostazioni sono per-vault. Ma una scelta della
  // pagina «Componenti» che accende o spegne un formato (la lavagna) rimonta il
  // vault: `vault_closed` e subito `vault_opened` dello stesso `root`. Quella
  // non è una chiusura, e il pannello resta dov'è; per saperlo si aspetta un
  // momento prima di chiudere. Un altro vault che si apre chiude subito.
  let closing: { root: string; timer: ReturnType<typeof setTimeout> } | null = null;
  const stopClosing = () => {
    if (closing) clearTimeout(closing.timer);
    closing = null;
  };
  const stopVault = onEvent("vault_closed", (event) => {
    stopClosing();
    if (lifetime.closed) return;
    if (!release) {
      close();
      return;
    }
    const timer = setTimeout(() => {
      closing = null;
      if (!lifetime.closed) close();
    }, VAULT_REMOUNT_GRACE_MS);
    closing = { root: event.root, timer };
  });
  if (typeof stopVault === "function") lifetime.add(stopVault);
  const stopReopen = onEvent("vault_opened", (event) => {
    const pending = closing;
    if (!pending || lifetime.closed) return;
    stopClosing();
    if (event.root !== pending.root) close();
  });
  if (typeof stopReopen === "function") lifetime.add(stopReopen);
  lifetime.add(stopClosing);
  componentsPage = mountComponentsPage(lifetime, {
    visible: () => !lifetime.closed && !panelEl.hidden && tab === "components",
    reloadProvider: () => settingsHooks.reloadProvider(),
  });
  lifetime.add(registerComponentRow((id) => void openComponentRow(id)));
  lifetime.add(() => {
    cancelCssSnippetsPreview();
    race.cancel();
    release?.();
    release = null;
    openedLifetime?.close();
    openedLifetime = null;
  });
  syncToolbar();
  return teardown;
}

let mountedTeardown: Teardown | null = null;

/// La pagina «Componenti»: vive quanto il pannello, così la sua ricerca e il suo
/// avviso non si ricostruiscono a ogni ridisegno della scheda.
export let componentsPage: ComponentsPage;

/// Quanto il pannello aspetta, dopo un `vault_closed`, il `vault_opened` dello
/// stesso vault che dice «era un rimontaggio».
const VAULT_REMOUNT_GRACE_MS = 2000;

export let settingsLifetime: Lifetime | null = null;

/// Il controllo degli aggiornamenti della scheda «Informazioni»: vive quanto il
/// pannello, e il suo esito ridisegna la scheda se è quella aperta.
export let updateChecker: UpdateChecker | null = null;

/// Come si scioglie la trappola del fuoco, quando il pannello è aperto.
///
/// È `null` a pannello chiuso, ed è il modo in cui `chiudi()` resta idempotente:
/// lo chiamano il pulsante, Escape e l'evento `vault_closed`, e senza questa
/// guardia il secondo giro rimetterebbe il fuoco dove stava *prima del primo*.
export let release: (() => void) | null = null;

/// La vita di un'apertura del pannello: si chiude con lui. Ci vive ciò che sta
/// sopra le impostazioni e non deve restarci senza (`Tutti i componenti`).
export let openedLifetime: Lifetime | null = null;

async function open(): Promise<void> {
  if (settingsLifetime?.closed || release) return;
  panelEl.hidden = false;
  syncToolbar();
  enterSurface(panelEl);
  // Il fuoco entra e resta: mentre le impostazioni sono aperte, sono quello che
  // si sta facendo (è la ragione per cui stanno sopra tutto anche visivamente,
  // scritto accanto al loro `z-index`). Una modale da cui il linguetta scappa mette
  // chi non vede a parlare con la UI sotto, che è ancora lì e non è più quella
  // che ha davanti.
  release = trapFocus(panelEl, close);
  openedLifetime = openLifetime();
  // La trappola mette il fuoco sul primo controllo, che nella scocca è la
  // chiusura: si comincia invece dalla scheda corrente, che dice dove si è.
  tabButtons().find((button) => button.dataset.tab === tab)?.focus();
  await render();
}

/// Apre le impostazioni sulla sezione che contiene la riga `key`, come chi
/// sceglie quella sezione dall'indice: la scheda «Impostazioni», la sezione
/// in cima e il fuoco sul suo titolo. La usa la scheda di un file Craft per
/// portare al gruppo «App esterne». Una riga che non c'è (il componente
/// spento) apre le impostazioni e basta.
export async function openSettingsAt(key: string): Promise<void> {
  const owner = settingsLifetime;
  if (!owner || owner.closed) return;
  if (tab !== "settings") {
    tab = "settings";
    pinnedRow = null;
    componentsGeneration++;
    syncToolbar();
  }
  if (release) await render();
  else await open();
  if (owner.closed || owner !== settingsLifetime) return;
  const row = bodyEl.querySelector<HTMLElement>(`[data-setting-key="${CSS.escape(key)}"]`);
  const section = row?.closest<HTMLElement>(".settings-section");
  if (section?.id) jumpTo(section.id);
}

export function close(): void {
  openedLifetime?.close();
  openedLifetime = null;
  release?.();
  race.cancel();
  cancelCssSnippetsPreview();
  void cancelThemePreview();
  componentsGeneration++;
  componentsPage?.reset();
  pendingRows.clear();
  blockedRows.clear();
  nextWrites.clear();
  rowErrors.clear();
  writtenRows.clear();
  openDetails.clear();
  dimenticaTastiDisegno();
  dimenticaMotore();
  release = null;
  renderedTab = null;
  renderedForm = null;
  resetFilters();
  if (searchEl) searchEl.value = "";
  exitSurface(panelEl, () => {
    panelEl.hidden = true;
  });
}

/// Quale disegno è l'ultimo chiesto.
///
/// Serve perché `disegna` è **ri-entrante**, e non per un caso di laboratorio:
/// un evento che arriva mentre un disegno legge ne fa partire un altro, e due
/// schede cliccate di fila ne fanno partire due. Svuotare *prima*
/// dell'`await` e appendere *dopo* darebbe «svuota, svuota, appendi N,
/// appendi N», cioè il contenuto doppio o due schede mescolate. Qui si costruisce prima e si sostituisce dopo, in un
/// colpo solo, e il disegno che arriva in ritardo si accorge di non essere più
/// l'ultimo e si ritira.
const race = new Race();

export async function render(): Promise<void> {
  renderStarts++;
  rendersInFlight++;
  try {
    await renderWhole();
  } finally {
    rendersInFlight--;
  }
}

async function renderWhole(): Promise<void> {
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
  // Il fuoco dentro il corpo resta dov'era se il suo controllo sopravvive al
  // ridisegno (la pagina «Componenti» è sempre la stessa). Se invece il
  // controllo è stato ricostruito — ogni riga lo è, a ogni `setting_changed`,
  // anche per una chiave che non è la sua — il fuoco va sul controllo nuovo
  // della stessa riga: senza, cadeva su BODY e chi usa la tastiera ripartiva
  // dall'inizio della pagina (A03). Solo nella stessa scheda: cambiandola, il
  // controllo di prima non c'è più per nessuno.
  const focused = bodyEl.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const snapshot = focused ? focusSnapshot() : null;
  // Il testo scritto e non ancora salvato passa sul controllo nuovo prima che
  // il fuoco ci torni, così anche la selezione ritrova il suo testo (#401).
  const drafts = takeDrafts(bodyEl);
  writtenRows.clear();
  // Una riga in volo passa com'è nel disegno nuovo: mostra la scelta che la
  // persona sta facendo, non il salvato di prima, e la sua scrittura la
  // ridisegnerà all'esito.
  const carried = renderedTab === tab ? carryPendingRows(nodes) : [];
  replacingBody = true;
  try {
    bodyEl.replaceChildren(...nodes);
  } finally {
    replacingBody = false;
  }
  renderedForm = tab === "settings" ? formSnapshots.get(nodes) ?? null : null;
  for (const key of carried) renderedForm?.rows.set(key, "");
  if (renderedTab === tab) restoreDrafts(drafts, bodyEl);
  else chosenSection = null;
  rememberSavedValues(bodyEl);
  if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  scrollEl.scrollTop = renderedTab === tab ? scrollTop : 0;
  if (snapshot && !focused?.isConnected && renderedTab === tab && document.activeElement === document.body) {
    restoreFocus(snapshot);
  }
  renderedTab = tab;
  syncToolbar();
  buildToc();
  applyFilter();
}

/// Mette nel disegno nuovo, al posto della loro riga nuova, le righe in volo del
/// corpo di adesso; torna le loro chiavi.
function carryPendingRows(nodes: readonly HTMLElement[]): string[] {
  const carried: string[] = [];
  for (const key of pendingRows) {
    const selector = `.setting-row[data-setting-key="${CSS.escape(key)}"]`;
    const old = bodyEl.querySelector<HTMLElement>(selector);
    const fresh = nodes.map((node) => node.matches(selector) ? node : node.querySelector<HTMLElement>(selector)).find(Boolean);
    if (!old || !fresh) continue;
    old.hidden = false;
    fresh.replaceWith(old);
    carried.push(key);
  }
  return carried;
}

function tabContent(): Promise<HTMLElement[]> {
  if (tab === "settings") return renderForm();
  if (tab === "components") return renderComponents();
  if (tab === "shortcuts") return renderShortcuts();
  if (tab === "about") return renderAbout();
  return renderVault();
}

// --- l'aggiornamento per riga ------------------------------------------------
//
// Un `setting_changed` col pannello aperto cambiava di solito una riga sola, e
// ricostruiva tutto il corpo: centinaia di nodi rifatti, lo stile ricalcolato
// per tutti e una lettura dello scroll che lo forzava subito, a ogni passo del
// cursore dell'accento. Qui la scheda della configurazione rilegge le
// impostazioni, confronta ciò che ogni riga mostra con ciò che dovrebbe
// mostrare, e sostituisce solo le righe diverse, con il conto della loro
// sezione, il suo «Ripristina gruppo» e il numero nell'indice.
//
// Ricade sul ridisegno intero ciò che una riga sola non sa dire: un evento
// senza chiave («può essere cambiato tutto»), uno schema diverso (righe
// comparse, sparite o ridichiarate), le chiavi che cambiano più di una riga
// (`WHOLE_FORM_KEYS`) e ogni altra scheda.

/// Ciò che la scheda della configurazione disegnata mostra: lo schema delle sue
/// righe e, per ogni riga, ciò da cui dipende il suo disegno.
export interface FormSnapshot {
  schema: string;
  rows: Map<string, string>;
}

/// Il disegno della scheda della configurazione nel corpo adesso, o `null` se il
/// corpo mostra altro (un'altra scheda, un errore di lettura).
let renderedForm: FormSnapshot | null = null;

/// Lo stato di ogni disegno costruito, che diventa `renderedForm` solo quando
/// quel disegno entra davvero nel corpo.
export const formSnapshots = new WeakMap<HTMLElement[], FormSnapshot>();

/// Quanti ridisegni interi sono partiti e quanti sono in volo: un
/// aggiornamento per riga che ne incrocia uno si ritira e lascia fare a lui.
let renderStarts = 0;

let rendersInFlight = 0;

/// L'ultimo aggiornamento per riga chiesto: uno più vecchio si ritira, perché
/// quello nuovo rilegge e confronta tutte le righe comunque.
let rowsGeneration = 0;

/// Le righe della scheda della configurazione, fra tutte le impostazioni.
export function formRows(all: readonly SettingEntry[]): SettingEntry[] {
  const shortcuts = new Set(allCommands().map((command) => keybindingKey(command.id)));
  return all.filter(
    (e) => !shortcuts.has(e.spec.key) && !isPermissionKey(e.spec.key) && !MANAGED_ELSEWHERE.has(e.spec.key),
  );
}

export function schemaOf(entries: readonly SettingEntry[]): string {
  return JSON.stringify(entries.map((entry) => entry.spec));
}

/// Ciò da cui dipende il disegno di una riga oltre il suo schema.
export function rowSignature(entry: SettingEntry): string {
  const key = entry.spec.key;
  return JSON.stringify([entry.value, entry.source, pendingRows.has(key), rowErrors.get(key) ?? null]);
}

/// I nodi che la vista mette nel controllo di una riga (il campo, l'esito):
/// tutto il resto che ci si trova l'ha messo qualcun altro — la veste di una
/// shell — e l'aggiornamento della riga lo lascia dov'è.
export const viewParts = new WeakSet<Element>();

/// Aggiorna `old` **sul posto** con il disegno di `next`: gli attributi della
/// riga, il testo e i nodi della vista nel controllo. La riga resta lo stesso
/// nodo, e i nodi di altri nel controllo — una veste col fuoco — non si
/// staccano mai: staccarli toglieva il fuoco a chi stava trascinando il
/// cursore. `hidden` è del filtro, e resta. Una riga che non ha la forma
/// attesa si sostituisce intera.
function patchRow(old: HTMLElement, next: HTMLElement): HTMLElement {
  const oldText = old.querySelector(":scope > .setting-text");
  const newText = next.querySelector(":scope > .setting-text");
  const oldControl = old.querySelector(":scope > .setting-control");
  const newControl = next.querySelector(":scope > .setting-control");
  if (!oldText || !newText || !oldControl || !newControl) {
    old.replaceWith(next);
    return next;
  }
  for (const name of old.getAttributeNames()) {
    if (name !== "hidden" && !next.hasAttribute(name)) old.removeAttribute(name);
  }
  for (const name of next.getAttributeNames()) {
    const value = next.getAttribute(name)!;
    if (name !== "hidden" && old.getAttribute(name) !== value) old.setAttribute(name, value);
  }
  oldText.replaceWith(newText);
  for (const child of [...oldControl.children]) if (viewParts.has(child)) child.remove();
  // I nodi della vista vanno prima: una veste sta subito dopo il campo che
  // pilota, e così lo ritrova al suo posto.
  oldControl.prepend(...newControl.children);
  return old;
}

/// Il corpo dopo un cambio di `key`: le righe sole quando si può, tutto se no.
function refresh(key: string | null | undefined): Promise<void> {
  const rowsWillDo =
    typeof key === "string" && key !== "" && !WHOLE_FORM_KEYS.has(key) &&
    tab === "settings" && renderedTab === "settings" && renderedForm !== null && rendersInFlight === 0;
  return rowsWillDo ? refreshRows() : render();
}

async function refreshRows(): Promise<void> {
  const owner = settingsLifetime;
  if (!owner || owner.closed) return;
  const generation = ++rowsGeneration;
  const starts = renderStarts;
  let entries: SettingEntry[];
  try {
    entries = formRows(await settings());
    await loadOwnListFields(entries);
  } catch {
    // Chi non riesce a rileggere lo dice col disegno intero, che ha già il
    // suo avviso.
    if (generation === rowsGeneration && starts === renderStarts) await render();
    return;
  }
  if (owner.closed || owner !== settingsLifetime || generation !== rowsGeneration || starts !== renderStarts) return;
  const form = renderedForm;
  if (!form || tab !== "settings" || renderedTab !== "settings" || schemaOf(entries) !== form.schema) {
    await render();
    return;
  }
  const dirty = entries.filter((entry) => form.rows.get(entry.spec.key) !== rowSignature(entry));
  if (dirty.length === 0) return;
  if (dirty.some((entry) => WHOLE_FORM_KEYS.has(entry.spec.key))) {
    await render();
    return;
  }
  const touched = new Set<HTMLElement>();
  for (const entry of dirty) {
    const key = entry.spec.key;
    // Una riga in volo la ridisegna la sua scrittura, quando la fila è vuota:
    // qui mostrerebbe un salvato che la persona sta già cambiando.
    if (pendingRows.has(key)) continue;
    const old = bodyEl.querySelector<HTMLElement>(`.setting-row[data-setting-key="${CSS.escape(key)}"]`);
    if (!old) {
      await render();
      return;
    }
    const focused = old.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const drafts = takeDrafts(old);
    if (focused && drafts.length > 0) {
      // La riga in cui si sta scrivendo resta quella che è: il testo, il
      // cursore e la selezione non si toccano. Il valore salvato nuovo lo
      // dice la riga sotto il campo, e la riga si ridisegna al suo esito.
      noteSavedValues(old, renderRow(entry), drafts);
      continue;
    }
    const snapshot = focused ? focusSnapshot(false) : null;
    let next: HTMLElement;
    replacingBody = true;
    try {
      next = patchRow(old, renderFormRow(entry));
    } finally {
      replacingBody = false;
    }
    writtenRows.delete(key);
    restoreDrafts(drafts, next);
    rememberSavedValues(next);
    if (snapshot && (!focused?.isConnected || document.activeElement !== focused)) restoreFocus(snapshot);
    form.rows.set(key, rowSignature(entry));
    const section = next.closest<HTMLElement>(".settings-section");
    if (section) touched.add(section);
  }
  if (touched.size > 0) {
    const groups = groupEntries(entries);
    for (const [index, group] of groups.entries()) {
      const section = document.getElementById(sectionAnchor(group.title, index));
      if (section && touched.has(section)) refreshSectionHead(section, group);
    }
  }
  const { query, modified } = filters.settings;
  if (modified || searchTerms(query).length > 0) applyFilter();
}

/// Il conto delle modificate e «Ripristina gruppo» di una sezione, rifatti
/// sulle sue righe di adesso, e il numero della sua voce nell'indice.
function refreshSectionHead(section: HTMLElement, group: Group): void {
  const head = section.querySelector<HTMLElement>(":scope > .settings-section-head");
  if (!head) return;
  head.querySelector(".settings-section-meta")?.remove();
  const oldReset = head.querySelector<HTMLButtonElement>(".settings-section-reset");
  const resetHadFocus = oldReset !== null && oldReset === document.activeElement;
  oldReset?.remove();
  delete section.dataset.modifiedCount;
  const changed = group.rows.filter(isModified);
  markModified({ section, head, body: head }, changed.length);
  const reset = groupReset(group, changed);
  if (reset) {
    head.append(reset);
    if (resetHadFocus) reset.focus({ preventScroll: true });
  }
  const link = tocListEl?.querySelector<HTMLButtonElement>(`button[data-target="${CSS.escape(section.id)}"]`);
  const item = link?.closest("li");
  if (!link || !item) return;
  const next = tocItem(section);
  next.hidden = item.hidden;
  const nextLink = next.querySelector<HTMLButtonElement>("button")!;
  if (link.hasAttribute("aria-current")) nextLink.setAttribute("aria-current", "true");
  const linkHadFocus = document.activeElement === link;
  item.replaceWith(next);
  if (linkHadFocus) nextLink.focus({ preventScroll: true });
}

/// La riga tenuta perché ci si sta scrivendo: il valore salvato che la sua
/// bozza ora contraddice si ricorda, e se è cambiato da fuori una riga lo dice,
/// come dopo un ridisegno intero.
function noteSavedValues(row: HTMLElement, fresh: HTMLElement, drafts: readonly Draft[]): void {
  for (const draft of drafts) {
    const el = row.querySelector(`[id="${draft.id}"]`);
    const now = fresh.querySelector(`[id="${draft.id}"]`);
    if (!isDraftControl(el) || !isDraftControl(now)) continue;
    savedValues.set(el, { saved: now.value, base: draft.base });
    if (now.value !== draft.base && !document.getElementById(`${el.id}-changed`)) showSavedChanged(el);
  }
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
  tocListEl.replaceChildren(...all.map(tocItem));
  tocEl.hidden = all.length < 2;
}

function tocItem(section: HTMLElement): HTMLLIElement {
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

/// La sezione in lettura: quella scelta nell'indice, finché chi legge non
/// scorre di suo; sennò l'ultima il cui titolo è salito oltre il bordo alto
/// del corpo. In fondo allo scroll è l'ultima, anche se è corta e il suo titolo
/// non può salire fin lassù.
function updateTocCurrent(): void {
  if (!tocListEl || !tocEl || tocEl.hidden) return;
  const visible = sections().filter((section) => !section.hidden);
  if (visible.length === 0) return;
  const top = scrollEl.getBoundingClientRect().top;
  let current = visible[0]!;
  const chosen = chosenSection === null ? undefined : visible.find((section) => section.id === chosenSection);
  if (chosenSection !== null && !chosen) chosenSection = null;
  const atEnd = scrollEl.scrollTop > 0 && scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2;
  if (chosen) current = chosen;
  else if (atEnd) current = visible[visible.length - 1]!;
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
  chosenSection = id;
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
export interface SectionParts {
  section: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
}

export function sectionBlock(title: string, index: number, options: { card?: boolean; hint?: string } = {}): SectionParts {
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
export function markModified(parts: SectionParts, count: number): void {
  if (count === 0) return;
  parts.section.dataset.modifiedCount = String(count);
  const meta = document.createElement("span");
  meta.className = "settings-section-meta";
  meta.textContent = plural(count, "settings.group.modified.one", "settings.group.modified");
  parts.head.querySelector(".settings-section-title")?.after(meta);
}

/// Scritture in volo e fallite, per chiave: è ciò che disegna l'esito vicino
/// al controllo (U53) invece di dirlo solo in un toast lontano dalla riga.
///
/// Non sono un bus né uno store: due contenitori di questo pannello, letti da
/// `renderRow`/`renderPermission` e scritti da `writeRow` e dal watcher
/// `setting_changed`. La chiusura le svuota, così una riapertura non ritrova
/// esiti di un vault che non c'è più.
export const pendingRows = new Set<string>();

interface RowError {
  message: string;
  input: string;
}

export const rowErrors = new Map<string, RowError>();

/// L'esito di una scrittura in volo, vicino al controllo che l'ha chiesta.
///
/// Il testo riusa una chiave esistente via `t()` (nessuna attesa P8): la riga
/// è marcata `aria-busy`, e un secondo invio dalla stessa riga si mette in fila
/// dietro quello in volo (`writeRow`).
export function rowPending(): HTMLElement {
  const el = row("setting-pending", t("save.saving"));
  viewParts.add(el);
  el.setAttribute("role", "status");
  return el;
}

/// L'esito di una scrittura fallita, vicino al controllo che l'ha chiesta.
///
/// Il controllo mostra il valore autorevole appena riletto, e qui sotto resta
/// l'input che l'utente aveva provato: nessuno dei due sparisce in un toast.
/// `role="alert"` lo annuncia a chi non guarda lo schermo.
export function rowErrorNode(err: RowError): HTMLElement {
  const box = document.createElement("div");
  viewParts.add(box);
  box.className = "setting-error";
  box.setAttribute("role", "alert");
  box.append(row("setting-error-message", err.message));
  if (err.input !== "") box.append(row("setting-attempted", err.input));
  return box;
}

/// Come si scrive una riga, oltre al suo valore.
interface RowWriteOptions {
  /// La frase da dire se non è andata: un permesso non cambiato e
  /// un'impostazione non cambiata sono due cose diverse per chi legge, e dirle
  /// uguali manderebbe a cercare il difetto nella scheda sbagliata.
  failure?: Key;
  /// La scrittura è un **cambio rispetto al valore disegnato** (una voce
  /// aggiunta o tolta da una lista), non un valore intero: una seconda
  /// scrittura partita dallo stesso disegno perderebbe la prima. La riga in
  /// volo allora si spegne finché l'esito non la ridisegna.
  block?: boolean;
}

/// Una scrittura chiesta da una riga.
interface RowWrite {
  attempted: string | null;
  action: () => Promise<void>;
  failure: Key;
}

/// La scrittura che aspetta quella in volo della stessa chiave: una sola, la
/// più recente. Le richieste di mezzo non partono mai.
const nextWrites = new Map<string, RowWrite>();

/// Le righe in volo spente (`block`): le sole i cui controlli si disabilitano.
export const blockedRows = new Set<string>();

/// Scrive una riga, e la ridisegna (con `refresh`, la riga sola quando si
/// può): la sourceLabel cambia insieme al valore, e un form che non si
/// ridisegnasse mostrerebbe «valore predefinito» sotto un valore appena scelto.
///
/// La riga in volo **resta usabile** e il fuoco resta dov'è (A03): dice
/// l'attesa con `aria-busy` e la riga «Salvataggio…», e chi continua a
/// scegliere — un cursore tenuto premuto, due clic di fila — non perde il gesto.
/// Le scritture della stessa chiave sono in fila: una sola in volo, e dietro
/// solo l'ultima chiesta, che prende il posto di quella che aspettava. Così
/// all'host arrivano in ordine, l'ultima vince e una vecchia non la può
/// sovrascrivere. Il ridisegno arriva una volta, quando la fila è vuota.
///
/// `attempted` è l'input che l'utente aveva provato, come lo scriverebbe un
/// umano (`null` dove non c'è un input: azzera): se l'ultima scrittura della
/// fila non va, resta sotto la riga mentre il controllo torna al valore
/// autorevole. L'esito di una scrittura superata da una più nuova non conta:
/// vale quello della volontà più recente.
export async function writeRow(
  key: string,
  attempted: string | null,
  action: () => Promise<void>,
  options: RowWriteOptions = {},
): Promise<void> {
  const request: RowWrite = { attempted, action, failure: options.failure ?? "settings.not_changed" };
  pinnedRow = key;
  if (pendingRows.has(key)) {
    nextWrites.set(key, request);
    return;
  }
  // Dove stava guardando l'utente: se il ridisegno dell'esito toglie il
  // controllo che aveva il fuoco (lo ricostruisce), il fuoco torna sul
  // controllo nuovo della stessa riga invece di cadere su BODY (A03). Senza lo
  // scroll: lo rimette già il ridisegno intero, e la riga sola non lo cambia.
  const snapshot = focusSnapshot(false);
  pendingRows.add(key);
  if (options.block) blockedRows.add(key);
  rowErrors.delete(key);
  // Dopo il gesto che l'ha chiesta, non dentro: un radiogroup attiva e poi
  // sposta il fuoco nello stesso giro.
  await Promise.resolve();
  if (pendingRows.has(key)) markPending(key, options.block === true);
  let failed: RowError | null = null;
  for (let current: RowWrite | undefined = request; current; current = nextWrites.get(key)) {
    nextWrites.delete(key);
    try {
      await current.action();
      failed = null;
    } catch (e) {
      failed = { message: t(current.failure, { reason: errorText(e) }), input: current.attempted ?? "" };
    }
  }
  if (failed) rowErrors.set(key, failed);
  else rowErrors.delete(key);
  pendingRows.delete(key);
  blockedRows.delete(key);
  // Il testo di questa riga ha avuto il suo esito: il ridisegno mostra il
  // valore autorevole e non lo riporta come bozza (l'input provato, se è
  // andata male, sta già sotto la riga).
  writtenRows.add(key);
  await refresh(key);
  // Ripara solo ciò che il ridisegno ha rotto: se nel frattempo l'utente si è
  // spostato, il focus attuale non si tocca.
  if (document.activeElement === document.body) restoreFocus(snapshot);
}

/// Il giro di pending **sulla riga sola**: la riga dice l'attesa, e solo una
/// riga `block` spegne i suoi controlli. Il ridisegno resta uno, dopo l'esito,
/// perché cambia la provenienza.
function markPending(key: string, block: boolean): void {
  const el = bodyEl.querySelector<HTMLElement>(`[data-setting-key="${key}"]`);
  if (!el) return;
  // La riga ora mostra l'attesa, che nessuno stato salvato dice: il prossimo
  // aggiornamento la ridisegna comunque.
  renderedForm?.rows.set(key, "");
  el.setAttribute("aria-busy", "true");
  el.querySelector(".setting-error")?.remove();
  el.querySelector(".setting-text")?.append(rowPending());
  if (!block) return;
  for (const node of el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
    node.disabled = true;
  }
}

/// Un valore che la riga stessa rifiuta prima di scriverlo (un numero che non
/// è il numero scritto, una scorciatoia che non si sa premere): come per un
/// rifiuto dell'host, il controllo torna al valore salvato e sotto la riga
/// restano il motivo e ciò che si era scritto. Niente parte verso l'host, e il
/// valore salvato resta quello che era.
export function refuseRow(key: string, message: string, attempted: string): void {
  rowErrors.set(key, { message, input: attempted });
  // Il testo rifiutato non è una bozza da portare oltre il ridisegno: sta già
  // sotto la riga.
  writtenRows.add(key);
  pinnedRow = key;
  const snapshot = focusSnapshot(false);
  void refresh(key).then(() => {
    if (document.activeElement === document.body) restoreFocus(snapshot);
  });
}

/// Chi torna a scrivere in una riga rifiutata non porta con sé l'esito di
/// prima: il motivo valeva per ciò che aveva scritto allora (IMP-022).
function forgetRowError(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const row = target.closest<HTMLElement>("[data-setting-key]");
  const key = row?.dataset.settingKey;
  if (!row || key === undefined || !rowErrors.has(key)) return;
  rowErrors.delete(key);
  row.querySelector(".setting-error")?.remove();
  // La riga non dice più ciò che il suo stato ricordato dice: il prossimo
  // aggiornamento la ridisegna.
  renderedForm?.rows.set(key, "");
}

/// Scrive senza una riga (banner dei tasti proposti, catalogo dei temi,
/// registro dei vault): qui non c'è un controllo a cui legare l'esito, e
/// l'errore resta nel toast come prima.
export async function write(
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
  /// `null` quando lo scroll non va rimesso: un aggiornamento per riga non
  /// cambia l'altezza di ciò che sta sopra, e leggerlo forzerebbe il layout.
  scrollTop: number | null;
}

function focusSnapshot(withScroll = true): FocusSnapshot {
  const focused = document.activeElement;
  return {
    controlId: focused instanceof HTMLElement ? focused.id : "",
    choice: focused instanceof HTMLElement ? focused.dataset.choice ?? null : null,
    rowKey:
      focused instanceof HTMLElement
        ? focused.closest("[data-setting-key]")?.getAttribute("data-setting-key") ?? null
        : null,
    selectionStart: hasTextSelection(focused) ? focused.selectionStart : null,
    selectionEnd: hasTextSelection(focused) ? focused.selectionEnd : null,
    scrollTop: withScroll ? scrollEl.scrollTop : null,
  };
}

/// Un campo di testo o un'area: quelli la cui selezione si ritrova dopo il
/// ridisegno.
function hasTextSelection(el: Element | null | undefined): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === "text");
}

/// Rimette il focus sullo stesso controllo della stessa riga dopo il rebuild.
function restoreFocus(snapshot: FocusSnapshot): void {
  if (snapshot.scrollTop !== null) scrollEl.scrollTop = snapshot.scrollTop;
  if (snapshot.rowKey === null || snapshot.rowKey === "") {
    // Fuori da una riga (un bottone di sezione, il catalogo dei temi) vale
    // soltanto l'id: senza, non c'è un posto sicuro dove rimettere il fuoco.
    const own = snapshot.controlId ? bodyEl.querySelector<HTMLElement>(`[id="${snapshot.controlId}"]`) : null;
    if (own && document.activeElement !== own) own.focus({ preventScroll: true });
    return;
  }
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
    hasTextSelection(next) &&
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

// --- le bozze dei campi (#401) ----------------------------------------------
//
// Un ridisegno intero ricostruisce tutte le righe col valore salvato, e un
// aggiornamento per riga quelle cambiate. Un campo in cui si stava scrivendo —
// il testo non ancora confermato con Invio o uscendo, la cartella da
// aggiungere, il CSS — perdeva così quello che c'era scritto. Qui il testo non
// salvato passa dal controllo vecchio a quello nuovo della stessa riga,
// riconosciuto dal suo `id`; la riga col fuoco e una bozza, nell'aggiornamento
// per riga, non si sostituisce affatto.
//
// Una bozza resta una bozza: niente la salva da sola. Torna solo nella stessa
// scheda (cambiandola, o chiudendo il pannello, la pagina di prima non c'è più
// per nessuno, come il suo fuoco), e cade quando la sua riga ha appena avuto
// l'esito di una scrittura (`writtenRows`): lì vale il valore autorevole, con
// l'input provato sotto se è andata male.

/// I controlli in cui si scrive del testo: le caselle, i numeri, le aree.
function isDraftControl(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && DRAFT_INPUT_TYPES.has(target.type);
}

const DRAFT_INPUT_TYPES = new Set(["text", "number", "search", "url", "email"]);

/// Chi scrive ha toccato questi controlli: un valore messo dal codice non è
/// una bozza.
const typedControls = new WeakSet<HTMLInputElement | HTMLTextAreaElement>();

/// Il valore salvato che il controllo mostrava quando è stato disegnato
/// (`saved`), e quello da cui la bozza è partita (`base`): sono diversi solo
/// se il salvato della sua chiave è cambiato mentre si scriveva.
const savedValues = new WeakMap<HTMLInputElement | HTMLTextAreaElement, { saved: string; base: string }>();

/// Le righe la cui scrittura ha appena avuto un esito: il prossimo ridisegno
/// non porta oltre il loro testo.
const writtenRows = new Set<string>();

/// Vero mentre il corpo si svuota: un browser che toglie il controllo col
/// fuoco può dargli un `blur`, e quello non è un'uscita di chi scrive.
let replacingBody = false;

interface Draft {
  id: string;
  value: string;
  base: string;
}

/// Il testo non salvato dei controlli di adesso sotto `root`, prima che cambi.
function takeDrafts(root: HTMLElement): Draft[] {
  const drafts: Draft[] = [];
  for (const el of root.querySelectorAll("input, textarea")) {
    if (!isDraftControl(el) || el.id === "" || !typedControls.has(el)) continue;
    const state = savedValues.get(el);
    if (!state || el.value === state.saved) continue;
    const key = el.closest("[data-setting-key]")?.getAttribute("data-setting-key") ?? null;
    if (key !== null && writtenRows.has(key)) continue;
    drafts.push({ id: el.id, value: el.value, base: state.base });
  }
  return drafts;
}

/// Rimette ogni bozza sul controllo nuovo con lo stesso `id`.
///
/// Se il salvato nel frattempo è diventato proprio la bozza, non c'è più niente
/// da portare. Se il salvato della sua chiave è cambiato da fuori mentre si
/// scriveva, la bozza resta — cancellarla in silenzio era il difetto — e una
/// riga sotto lo dice: chi conferma sceglie il suo testo sapendolo.
///
/// L'`input` sintetico rifà ciò che il controllo ricalcola mentre si scrive: il
/// cursore accanto al numero, la diagnosi di una scorciatoia.
function restoreDrafts(drafts: readonly Draft[], root: HTMLElement): void {
  for (const draft of drafts) {
    const el = root.querySelector(`[id="${draft.id}"]`);
    if (!isDraftControl(el)) continue;
    const saved = el.value;
    if (saved === draft.value) continue;
    el.value = draft.value;
    savedValues.set(el, { saved, base: draft.base });
    typedControls.add(el);
    if (el instanceof HTMLInputElement) keepConfirmGesture(el);
    if (saved !== draft.base) showSavedChanged(el);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/// Il valore salvato di ogni controllo appena disegnato sotto `root` che non
/// porta già una bozza.
function rememberSavedValues(root: HTMLElement): void {
  for (const el of root.querySelectorAll("input, textarea")) {
    if (isDraftControl(el) && !savedValues.has(el)) savedValues.set(el, { saved: el.value, base: el.value });
  }
}

/// Un campo con la bozza rimessa dal codice si conferma ancora come prima:
/// uscendo o con Invio. Il browser non lo sa — per lui il valore è cambiato
/// da programma, e il `change` non partirebbe — e allora lo si manda qui, una
/// volta sola e solo se il browser non l'ha già fatto.
function keepConfirmGesture(el: HTMLInputElement): void {
  let changed = false;
  el.addEventListener("change", () => { changed = true; });
  const settle = () => {
    if (changed || replacingBody || !el.isConnected || el.disabled) return;
    if (el.value === savedValues.get(el)?.saved) return;
    changed = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  el.addEventListener("blur", settle);
  // Al rilascio di Invio e non alla pressione: il `change` che il browser
  // manda su Invio, quando lo manda, è già arrivato.
  el.addEventListener("keyup", (event) => {
    if (event.key === "Enter") settle();
  });
}

/// La riga che dice che il salvato è cambiato da fuori mentre si scriveva.
function showSavedChanged(el: HTMLInputElement | HTMLTextAreaElement): void {
  const note = row("setting-source", t("settings.draft.saved_changed"));
  viewParts.add(note);
  note.id = `${el.id}-changed`;
  note.setAttribute("role", "status");
  const text = el.closest("[data-setting-key]")?.querySelector(".setting-text");
  if (text) text.append(note);
  else el.insertAdjacentElement("afterend", note);
  const existing = el.getAttribute("aria-describedby");
  el.setAttribute("aria-describedby", [note.id, ...(existing ? [existing] : [])].join(" "));
}

export let componentsGeneration = 0;
