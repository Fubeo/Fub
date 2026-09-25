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
} from "../host/contract";
import { onEvent } from "../state/kernel";
import { state } from "../state/store";
import { $ } from "../ui/dom";
import { trapFocus } from "../ui/a11y";
import { notify } from "../ui/notify";
import { allCommands, keybindingIssues, keybindingKey, validateKeybinding, type CommandEntry } from "../ui/commands";
import { TRUST_LABELS, isPermissionKey, rows, type PermissionRow } from "../ui/permissions";
import { errorText } from "../host/errors";
import { LANGUAGE_KEY, catalogLanguages, t, type Key } from "../i18n/strings";
import {
  CONTRAST_KEY,
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
import {
  CSS_SNIPPETS_KEY, DEFAULT_CSS_SNIPPETS, cancelCssSnippetsPreview,
  cssSnippetCatalog, disableCssSnippet, parseCssSnippets, previewCssSnippets,
  saveCssSnippets,
} from "../theme/snippets";
import { openLifetime, type Lifetime, type Teardown } from "../ui/lifetime";

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
/// un'altra macchina.
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

let tab: SettingsTab = "settings";

const settingsTabsId = "settings-body";

function tabButtons(): HTMLButtonElement[] {
  return [...tabsEl.querySelectorAll<HTMLButtonElement>("button[data-tab]")];
}


function moveTab(current: number, key: string, count: number): number | null {
  if (count < 1) return null;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/// Un radiogroup è una sola fermata nel Tab: la selezione corrente resta
/// tabbabile, mentre le frecce spostano sia il fuoco sia il valore. La
/// sincronizzazione è ottimistica (prima della scrittura asincrona), e il
/// successivo render rilegge il valore autorevole dal kernel.
function installRadioGroup(
  group: HTMLElement,
  select: (button: HTMLButtonElement) => void,
): void {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
  if (buttons.length === 0) return;

  const checked = buttons.find((button) => button.getAttribute("aria-checked") === "true");
  const tabbable = checked ?? buttons[0];
  for (const button of buttons) button.tabIndex = button === tabbable ? 0 : -1;

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
    button.addEventListener("click", () => activate(button));
    button.addEventListener("keydown", (event) => {
      const index = buttons.indexOf(button);
      let next: number | null = null;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (index - 1 + buttons.length) % buttons.length;
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (index + 1) % buttons.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = buttons.length - 1;
      }
      if (next === null) return;
      event.preventDefault();
      activate(buttons[next]);
    });
  }
}

function selectTab(next: SettingsTab, focus: boolean): void {
  if (tab === "settings" && next !== "settings") {
    void cancelThemePreview();
    cancelCssSnippetsPreview();
  }
  tab = next;
  componentsGeneration++;
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
  settingsHooks = nextHooks;
  panelEl = $("#settings-panel");
  bodyEl = $("#settings-body");
  tabsEl = $("#settings-tabs");
  tabsEl.setAttribute("role", "tablist");
  bodyEl.setAttribute("role", "tabpanel");
  bodyEl.id = settingsTabsId;
  lifetime.listen($("#open-settings"), "click", () => void open());
  lifetime.listen($("#settings-close"), "click", () => close());
  for (const button of tabButtons()) {
    const value = button.dataset.tab as SettingsTab;
    button.setAttribute("role", "tab");
    button.id = `settings-tab-${value}`;
    button.setAttribute("aria-controls", settingsTabsId);
    button.tabIndex = value === tab ? 0 : -1;
    button.setAttribute("aria-selected", String(value === tab));
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
  enterSurface(panelEl, { viewTransition: false });
  // Il fuoco entra e resta: mentre le impostazioni sono aperte, sono quello che
  // si sta facendo (è la ragione per cui stanno sopra tutto anche visivamente,
  // scritto accanto al loro `z-index`). Una modale da cui il linguetta scappa mette
  // chi non vede a parlare con la UI sotto, che è ancora lì e non è più quella
  // che ha davanti.
  release = trapFocus(panelEl, close);
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
  release = null;
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
        row("muted", t("settings.read_failed", { reason: errorText(e) })),
      ]),
    );
  });
  if (!nodes || owner.closed || owner !== settingsLifetime) return;
  bodyEl.replaceChildren(...nodes);
}

function tabContent(): Promise<HTMLElement[]> {
  if (tab === "settings") return renderForm();
  if (tab === "components") return renderComponents();
  if (tab === "shortcuts") return renderShortcuts();
  return renderVault();
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
  if (entries.length === 0) nodes.push(row("muted", t("settings.none")));
  for (const group of groupEntries(entries)) {
    nodes.push(groupTitle(group));
    for (const entry of group.rows) {
      if (entry.spec.key === CSS_SNIPPETS_KEY) continue;
      const item = renderRow(entry);
      if (entry.spec.key === "chrome.frame") {
        const [capabilities, reopen] = await Promise.allSettled([
          Promise.resolve().then(() => api.frameCapabilities()),
          Promise.resolve().then(() => api.settingRequiresReopen(entry.spec.key)),
        ]);
        if (capabilities.status === "fulfilled") {
          const select = item.querySelector("select");
          for (const option of select?.options ?? []) {
            if (option.value === "system") option.disabled = !capabilities.value.system;
            if (option.value === "custom") option.disabled = !capabilities.value.custom;
          }
          if (!capabilities.value.system && !capabilities.value.custom && select) select.disabled = true;
        } else {
          const select = item.querySelector("select");
          if (select) select.disabled = true;
          item.querySelector(".setting-text")?.append(
            row("setting-source", t("settings.frame.unavailable", { reason: errorText(capabilities.reason) })),
          );
        }
        if (reopen.status === "fulfilled" && reopen.value) {
          item.querySelector(".setting-text")?.append(row("setting-source", t("settings.frame.reopen")));
        }
      }
      nodes.push(item);
    }
  }
  const themes = await themeCatalog().catch(() => []);
  if (themes.length > 0 && entries.some((entry) => entry.spec.key === THEME_KEY)) {
    nodes.push(renderThemeCatalog(themes));
  }
  const css = entries.find((entry) => entry.spec.key === CSS_SNIPPETS_KEY);
  if (css) nodes.push(renderCssSnippets(css));
  nodes.push(...await renderProfiles());
  return nodes;
}

/// Le chiavi che hanno un gesto loro altrove, e che nel form generico sarebbero
/// un campo da non toccare a mano: la versione del formato dell'interfaccia,
/// i componenti spenti (la scheda Componenti), l'ordine della barra laterale
/// (si trascina nella barra), i tipi delle proprietà (il pannello Proprietà) e
/// l'id del tema installato (il catalogo dei temi qui sotto).
const MANAGED_ELSEWHERE = new Set([
  "chrome.schema",
  "plugins.disabled",
  "chrome.rail.order",
  "properties.types",
  "appearance.theme-id",
]);

/// L'intestazione di un gruppo, con «Ripristina gruppo» quando nel gruppo c'è
/// qualcosa di diverso dal default: riportare indietro una sezione intera era
/// un «Azzera» riga per riga.
function groupTitle(group: Group): HTMLElement {
  const title = document.createElement("div");
  title.className = "panel-title";
  const name = document.createElement("span");
  name.setAttribute("role", "heading");
  name.setAttribute("aria-level", "3");
  name.textContent = group.title;
  title.append(name);
  const changed = group.rows.filter((entry) => entry.source !== "default");
  if (changed.length > 0) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "link-button";
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
    title.append(reset);
  }
  return title;
}

function renderCssSnippets(entry: SettingEntry): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "setting-row setting-row--theme";
  panel.dataset.settingKey = CSS_SNIPPETS_KEY;
  panel.append(row("panel-title", entry.spec.label));
  panel.append(row("muted", t("settings.css.hint")));
  const source = document.createElement("textarea");
  source.setAttribute("aria-label", entry.spec.label);
  source.rows = 7;
  source.value = typeof entry.value === "string" ? entry.value : DEFAULT_CSS_SNIPPETS;
  const status = row("setting-source", t("settings.css.trust"));
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "settings-banner-actions";
  const preview = document.createElement("button");
  preview.type = "button";
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
  cancel.textContent = t("settings.css.cancel_preview");
  cancel.addEventListener("click", () => {
    cancelCssSnippetsPreview();
    status.textContent = t("settings.css.preview_cancelled");
  });
  const save = document.createElement("button");
  save.type = "button";
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
      line.className = "setting-row setting-sub";
      line.append(row("setting-source", t(snippet.enabled ? "settings.css.snippet_on" : "settings.css.snippet_off", { id: snippet.id }) + (errors.get(snippet.id) ? ` · ${errors.get(snippet.id)}` : "")));
      if (snippet.enabled) {
        const off = document.createElement("button");
        off.type = "button";
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

async function renderProfiles(): Promise<HTMLElement[]> {
  const scopes: { scope: SettingScope; vault?: string }[] = [{ scope: "machine" }];
  if (state.vaultRoot) scopes.push({ scope: "vault", vault: state.vaultRoot });
  const results = await Promise.allSettled(scopes.map(({ scope, vault }) =>
    Promise.resolve().then(() => api.settingsProfiles(scope, vault))));
  return scopes.map(({ scope, vault }, index) => {
    const box = document.createElement("section");
    box.className = "settings-banner";
    box.append(row("panel-title", t(scope === "machine" ? "settings.profiles.machine" : "settings.profiles.vault")));
    const result = results[index]!;
    if (result.status === "rejected") {
      box.append(row("muted", t("settings.profiles.unavailable", { reason: errorText(result.reason) })));
      return box;
    }
    const { active, names } = result.value;
    const choice = document.createElement("select");
    choice.setAttribute("aria-label", t("settings.profiles.choice"));
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === active;
      choice.append(option);
    }
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = t("settings.profiles.new_name");
    nameInput.setAttribute("aria-label", t("settings.profiles.new_name"));
    const json = document.createElement("textarea");
    json.rows = 5;
    json.placeholder = t("settings.profiles.json_placeholder");
    json.setAttribute("aria-label", t("settings.profiles.json"));
    const feedback = row("setting-source", t("settings.profiles.hint"));
    feedback.setAttribute("role", "status");
    let busy = false;
    const perform = async (action: () => Promise<unknown>, redraw = true) => {
      if (busy) return;
      busy = true;
      for (const control of box.querySelectorAll<HTMLButtonElement>("button")) control.disabled = true;
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
        for (const control of box.querySelectorAll<HTMLButtonElement>("button")) control.disabled = false;
      }
    };
    const button = (title: string, action: () => void) => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = title;
      control.addEventListener("click", action);
      box.append(control);
    };
    box.append(choice, nameInput, json, feedback);
    box.append(row("muted", t("settings.profiles.frame_hint")));
    button(t("settings.profiles.switch"), () => void perform(() => api.switchSettingsProfile(scope, choice.value, vault)));
    button(t("settings.profiles.duplicate"), () => {
      if (!nameInput.value.trim()) { feedback.textContent = t("settings.profiles.name_required"); return; }
      void perform(() => api.duplicateSettingsProfile(scope, choice.value, nameInput.value.trim(), vault));
    });
    button(t("settings.profiles.export"), () => void perform(async () => {
      json.value = await api.exportSettingsProfile(scope, choice.value, vault);
      feedback.textContent = t("settings.profiles.exported");
    }, false));
    button(t("settings.profiles.import"), () => {
      if (!json.value.trim()) { feedback.textContent = t("settings.profiles.json_required"); return; }
      // Pass the source verbatim. Parsing/reserializing here would discard
      // opaque values the native profile store knows how to retain.
      void perform(() => api.importSettingsProfile(scope, json.value, vault));
    });
    button(t("settings.profiles.reset"), () => {
      void (async () => {
        const accepted = await confirm(t("settings.profiles.reset_confirm", { profile: choice.value }), {
          title: t("settings.profiles.reset_title"), okLabel: t("settings.profiles.reset_ok"), danger: true,
        });
        if (accepted && box.isConnected) await perform(() => api.resetSettingsProfile(scope, choice.value, vault));
      })().catch((error: unknown) => { feedback.textContent = t("settings.profiles.reset_cancelled", { reason: errorText(error) }); });
    });
    return box;
  });
}

function renderThemeCatalog(themes: ThemeInfo[]): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "setting-row setting-row--theme";
  const text = document.createElement("div");
  text.className = "setting-text";
  const title = document.createElement("div");
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "3");
  title.textContent = t("settings.themes.title");
  const hint = row("muted", t("settings.themes.preview_hint"));
  text.append(title, hint);

  const control = document.createElement("div");
  control.className = "segmented segmented--wide theme-switch";
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
  actions.className = "theme-preview-actions";
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.textContent = t("settings.themes.apply");
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
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
  actions.append(applyButton, cancelButton);
  refreshPreviewState();

  text.append(
    row(
      "setting-source",
      t("settings.themes.source", {
        ids: themes.map((theme) => theme.manifest.id).join(", "),
      }),
    ),
    status,
  );
  panel.append(text, control, actions);
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
/// [0040]: ../../../docs/decisions/0192-impostazioni-locale-e-temi.md
function renderRow(entry: SettingEntry, name?: string, description?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  // Identità stabile della riga: dopo un re-render il focus torna sullo
  // stesso controllo (A03) invece di cadere su BODY.
  el.dataset.settingKey = entry.spec.key;
  // Il tema è la riga più guardata del gruppo Appearance: la si alza di
  // un gradino visivo, così l'occhio la trova prima delle altre impostazioni
  // di aspetto che le stanno attorno.
  if (entry.spec.key === THEME_KEY || entry.spec.key === CONTRAST_KEY) {
    el.classList.add("setting-row--theme");
  }

  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = name ?? entry.spec.label;
  label.htmlFor = `setting-${entry.spec.key}`;
  text.append(label);
  const below = description ?? entry.spec.description;
  const controlId = `setting-${entry.spec.key}`;
  const described: string[] = [];
  if (below) {
    const desc = row("muted", below);
    desc.id = `${controlId}-desc`;
    described.push(desc.id);
    text.append(desc);
  }
  const source = row("setting-source", sourceLabel(entry));
  source.id = `${controlId}-source`;
  described.push(source.id);
  text.append(source);
  const pending = pendingRows.has(entry.spec.key);
  const failure = rowErrors.get(entry.spec.key);
  if (pending) el.setAttribute("aria-busy", "true");

  const control = field(entry);
  // Chi arriva al campo col lettore di schermo sente anche cosa fa e dove
  // vale, non solo l'etichetta: la prosa sotto la riga era solo per gli occhi.
  const focusable = control.matches("input, select, textarea, [role=radiogroup]")
    ? control
    : control.querySelector<HTMLElement>("input, select, textarea");
  if (focusable) {
    const existing = focusable.getAttribute("aria-describedby");
    focusable.setAttribute("aria-describedby", [...described, ...(existing ? [existing] : [])].join(" "));
  }
  el.append(text, control);
  if (pending) text.append(rowPending());
  else if (failure) text.append(rowErrorNode(failure));

  // «Azzera» compare **solo dove c'è qualcosa da azzerare**: su una riga al
  // valore predefinito sarebbe un pulsante che non fa niente, cioè un pulsante
  // che insegna a non fidarsi dei pulsanti.
  if (entry.source !== "default") {
    const resetButton = document.createElement("button");
    resetButton.className = "link-button";
    resetButton.textContent = t("settings.reset");
    setTooltip(resetButton, t("settings.reset.hint"));
    resetButton.addEventListener("click", () => {
      void writeRow(entry.spec.key, null, () => api.resetSetting(entry.spec.key));
    });
    el.append(resetButton);
  }
  // Disabilitare solo la riga in volo, «azzera» compreso: le altre righe
  // restano scrivibili.
  if (pending) {
    for (const node of el.querySelectorAll("input, select, button")) {
      (node as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
    }
  }
  return el;
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

function readonlyListField(entry: SettingEntry, id: string): HTMLElement {
  const el = row("muted", show(entry.value));
  el.id = id;
  return el;
}

function listField(entry: SettingEntry, id: string): HTMLElement {
  const values = normalizedList(entry.value);
  const editor = document.createElement("div");

  if (values.length === 0) editor.append(row("muted", t("settings.list.none")));
  else {
    const list = document.createElement("ul");
    for (const [index, folder] of values.entries()) {
      const item = document.createElement("li");
      item.append(document.createTextNode(folder));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link-button";
      remove.textContent = t("settings.list.remove");
      remove.setAttribute("aria-label", t("settings.list.remove.hint", { folder }));
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
  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.autocomplete = "off";
  input.placeholder = t("settings.list.placeholder");
  const error = row("muted", "");
  error.id = `${id}-error`;
  error.setAttribute("role", "alert");
  error.setAttribute("aria-live", "polite");
  error.hidden = true;
  input.setAttribute("aria-describedby", error.id);

  const add = document.createElement("button");
  add.type = "submit";
  add.className = "link-button";
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

/// Il campo di una riga, dalla **specie dichiarata**.
///
/// Un caso per specie e nessun default: una specie nuova nel contratto arriva
/// qui come errore di compilazione (`mirror.test.ts` la ferma prima), non come
/// una riga che il pannello salta in silenzio.
function field(entry: SettingEntry): HTMLElement {
  const id = `setting-${entry.spec.key}`;
  const kind = entry.spec.kind;
  switch (kind.kind) {
    case "toggle": {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.checked = entry.value === true;
      input.addEventListener("change", () => {
        void writeRow(entry.spec.key, show(input.checked), () =>
          api.setSetting(entry.spec.key, input.checked),
        );
      });
      return input;
    }
    case "number": {
      const input = document.createElement("input");
      input.type = "number";
      input.id = id;
      input.value = String(entry.value);
      if (kind.min !== null) input.min = String(kind.min);
      if (kind.max !== null) input.max = String(kind.max);
      // Senza questa riga il passo è **uno**, e un `2.5` diventa un campo che il
      // browser segna come invalido. Lo scoperto lo ha portato il primo numero
      // vero dello schema — i pesi dei campi della ricerca (§21.6), che sono
      // frazionari per natura: un peso a metà strada fra il corpo e il titolo è
      // esattamente il genere di taratura per cui quelle chiavi esistono.
      //
      // «Qualunque passo» e non un passo dichiarato: `SettingKind::Number` ha
      // `min` e `max` e non ha uno `step`, e aggiungerglielo sarebbe firma. Il
      // valore lo controllano comunque i due estremi, che è ciò che il kernel
      // verifica davvero — lo `step` di un `input` è un aiuto alla digitazione,
      // non una regola sul dato.
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
    case "text": {
      if (entry.spec.key === LANGUAGE_KEY) return languageField(entry, id);
      const input = document.createElement("input");
      input.type = "text";
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
    case "choice": {
      // Il tema non è una tendina: tre scelte si vedono meglio come tre
      // segmenti affiancati, e la scelta corrente si riconosce senza aprire
      // niente. È la sola chiave che si prende questa strada: qualunque altra
      // `choice` ha più di tre opzioni, o meno, o le ha ma non è la prima cosa
      // che si guarda, e per quelle la `<select>` resta giusta.
      if (entry.spec.key === THEME_KEY || entry.spec.key === CONTRAST_KEY) {
        return appearanceToggle(entry, kind);
      }
      const select = document.createElement("select");
      select.id = id;
      // Il valore corrente potrebbe **non essere fra le opzioni**: un
      // `settings.json` scritto a mano, o uno schema che ha cambiato le proprie
      // scelte fra due versioni del plugin. Senza questa riga nessuna `option`
      // risulterebbe scelta e il browser mostrerebbe la prima — cioè un valore
      // falso, che è peggio di un valore strano.
      const current = String(entry.value);
      if (!kind.options.some((o) => o.value === current)) {
        const outside = document.createElement("option");
        outside.value = current;
        outside.textContent = t("settings.off_choices", { value: current });
        outside.selected = true;
        select.append(outside);
      }
      for (const option of kind.options) {
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label;
        el.selected = option.value === entry.value;
        select.append(el);
      }
      select.addEventListener("change", () => {
        void writeRow(entry.spec.key, select.value, () => api.setSetting(entry.spec.key, select.value));
      });
      return select;
    }
    case "list":
      return editableListKeys.has(entry.spec.key)
        ? listField(entry, id)
        : readonlyListField(entry, id);
  }
}

/// La lingua come scelta fra quelle in cui la shell sa parlare, invece di un
/// campo in cui indovinare un tag BCP 47. La chiave resta testo (il kernel
/// accetta `it-CH`): un valore scritto altrove resta visibile come scelta a sé.
function languageField(entry: SettingEntry, id: string): HTMLElement {
  const select = document.createElement("select");
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

/// Il tema come segmented control: i bottoni dello schema — sistema, chiaro,
/// scuro, e quel che verrà — invece di una tendina.
///
/// Le etichette sono quelle che lo schema della Choice porta già dal kernel:
/// l'`option.label` è localizzata là (0040), e ricopiarla qui vorrebbe dire
/// mantenere due traduzioni della stessa frase. Se l'opzione manca — un kernel
/// che non la dichiarasse — si mostra il valore nudo (o "system" se vuoto):
/// ripiego difensivo, non la strada. L'elenco non è più cablato qui: scorre
/// `kind.options` nell'ordine dello schema, così un'opzione nuova compare
/// senza una seconda lista da tenere a mano.
function appearanceToggle(
  entry: SettingEntry,
  kind: Extract<SettingEntry["spec"]["kind"], { kind: "choice" }>,
): HTMLElement {
  const current = String(entry.value);
  const customThemeActive = entry.spec.key === THEME_KEY && currentThemeId() !== SERIES_THEME_ID;
  const group = document.createElement("div");
  group.className = "segmented segmented--wide theme-switch";
  group.id = `setting-${entry.spec.key}`;
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", entry.spec.label);
  for (const op of kind.options) {
    const value = op.value;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segmented-option";
    btn.setAttribute("role", "radio");
    btn.textContent = op.label || value || "system";
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
    void writeRow(
      entry.spec.key,
      button.textContent || selectedValue,
      () =>
        entry.spec.key === THEME_KEY
          ? selectTheme(SERIES_THEME_ID, selectedValue as "" | "light" | "dark")
          : api.setSetting(entry.spec.key, selectedValue),
    );
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
  rowKey: string | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  scrollTop: number;
}

function focusSnapshot(): FocusSnapshot {
  const focused = document.activeElement;
  return {
    controlId: focused instanceof HTMLElement ? focused.id : "",
    rowKey:
      focused instanceof HTMLElement
        ? focused.closest("[data-setting-key]")?.getAttribute("data-setting-key") ?? null
        : null,
    selectionStart:
      focused instanceof HTMLInputElement && focused.type === "text" ? focused.selectionStart : null,
    selectionEnd:
      focused instanceof HTMLInputElement && focused.type === "text" ? focused.selectionEnd : null,
    scrollTop: bodyEl.scrollTop,
  };
}

/// Rimette il focus sullo stesso controllo della stessa riga dopo il rebuild.
function restoreFocus(snapshot: FocusSnapshot): void {
  bodyEl.scrollTop = snapshot.scrollTop;
  if (snapshot.rowKey === null || snapshot.rowKey === "") return;
  const selector = `[data-setting-key="${snapshot.rowKey}"]`;
  const scope = bodyEl.querySelector(selector);
  // Niente `CSS.escape`: gli id contengono punti (`setting-editor.line_numbers`)
  // che in un selettore `#` varrebbero come classi; la ricerca per attributo
  // quotato li tratta come testo.
  const next =
    (snapshot.controlId ? scope?.querySelector<HTMLElement>(`[id="${snapshot.controlId}"]`) : null) ??
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
  box.append(row("panel-title", t("settings.vault_keys.title", { count: keys.length })));
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
  actions.className = "settings-banner-actions";
  const adoptButton = document.createElement("button");
  adoptButton.className = "primary";
  adoptButton.textContent = t("settings.vault_keys.adopt");
  adoptButton.addEventListener("click", () => void write(() => api.adoptKeybindings()));
  const discardButton = document.createElement("button");
  discardButton.textContent = t("settings.vault_keys.discard");
  setTooltip(discardButton, t("settings.vault_keys.discard.hint"));
  discardButton.addEventListener("click", () => void write(() => api.discardKeybindings()));
  actions.append(adoptButton, discardButton);
  box.append(actions);
  return [box];
}

let shortcutFilter = "";

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
  const nodes: HTMLElement[] = [...suggested, row("muted", t("settings.shortcuts_hint"))];
  const filter = document.createElement("input");
  filter.type = "search";
  filter.value = shortcutFilter;
  filter.placeholder = t("settings.shortcuts.filter_placeholder");
  filter.setAttribute("aria-label", t("settings.shortcuts.filter"));
  nodes.push(filter);
  const lines: { element: HTMLElement; search: string }[] = [];
  const addCommand = (command: CommandEntry, label?: string, description?: string) => {
    const entry = byKey.get(keybindingKey(command.id));
    if (!entry) return;
    const element = renderRow(entry, label, description);
    const input = element.querySelector<HTMLInputElement>("input[type=text]");
    const diagnostic = row("setting-source", "");
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
    nodes.push(element);
    lines.push({ element, search: `${command.id} ${command.title} ${String(entry.value)}`.toLocaleLowerCase() });
  };
  for (const command of commands) {
    if (command.spec) addCommand(command);
  }
  const fromShell = commands.filter((command) => command.run !== null);
  if (fromShell.length > 0) {
    nodes.push(sectionTitle("settings.shortcuts.shell"));
    for (const command of fromShell) addCommand(command, command.title, command.description);
  }
  if (lines.length === 0) nodes.push(row("muted", t("settings.shortcuts.none")));
  const updateFilter = () => {
    shortcutFilter = filter.value;
    const needle = shortcutFilter.toLocaleLowerCase();
    for (const line of lines) line.element.hidden = !line.search.includes(needle);
  };
  filter.addEventListener("input", updateFilter);
  updateFilter();
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
  const nodes: HTMLElement[] = [
    installAction(),
    renderCatalogSearch(installed),
    row("muted", t("settings.components_hint")),
  ];
  if (limitedResult.status === "fulfilled") {
    nodes.push(row("setting-source", limitedResult.value.enabled
      ? t("settings.components.limited_on", { reason: limitedResult.value.reason ?? t("settings.components.limited_default") })
      : t("settings.components.limited_off")));
  } else nodes.push(row("setting-source", t("settings.components.limited_unavailable", { reason: errorText(limitedResult.reason) })));
  if (budgetResult.status === "fulfilled") {
    const b = budgetResult.value;
    nodes.push(row("setting-source", t("settings.components.budget", {
      live: b.live_instances, calls: b.total_calls, timeouts: b.timed_out_calls, oom: b.oom_calls,
    })));
  } else nodes.push(row("setting-source", t("settings.components.budget_unavailable", { reason: errorText(budgetResult.reason) })));
  if (bundleResult.status === "rejected") {
    nodes.push(row("muted", t("settings.read_failed", { reason: errorText(bundleResult.reason) })));
  }
  if (entryResult.status === "rejected") {
    nodes.push(row("muted", t("settings.read_failed", { reason: errorText(entryResult.reason) })));
  }

  if (native.length > 0) {
    nodes.push(sectionTitle("settings.components.bundled"));
    for (const bundle of native) nodes.push(...renderComponent(bundle, forKey));
  }

  nodes.push(sectionTitle("settings.components.installed"));
  if (installedResult.status === "rejected") {
    nodes.push(row("muted", t("settings.read_failed", { reason: errorText(installedResult.reason) })));
  } else if (installed.length === 0) {
    nodes.push(row("muted", t("settings.components.installed.none")));
  } else {
    for (const plugin of installed) nodes.push(...renderInstalledComponent(plugin, forKey));
  }
  return nodes;
}

function renderCatalogSearch(installed: InstalledPluginInfo[]): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "settings-banner";
  panel.append(row("panel-title", t("settings.catalog.title")));
  panel.append(row("muted", t("settings.catalog.hint")));
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = t("settings.catalog.search_placeholder");
  search.setAttribute("aria-label", t("settings.catalog.search"));
  const run = document.createElement("button");
  run.type = "button";
  run.textContent = t("settings.catalog.run");
  const status = row("setting-source", "");
  status.setAttribute("role", "status");
  const results = document.createElement("div");
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
  panel.append(search, run, status, results);
  return panel;
}

function renderCatalogEntry(entry: CatalogEntry, installed: InstalledPluginInfo[]): HTMLElement {
  const item = document.createElement("section");
  item.className = "setting-row";
  const details = document.createElement("div");
  details.className = "setting-text";
  details.append(
    row("panel-title", `${entry.name} · ${entry.version} · ${entry.kind}`),
    row("setting-source", t("settings.catalog.provenance", { publisher: entry.provenance, license: entry.license, compatible: String(entry.compatible) })),
    row("setting-source", t("settings.catalog.digest", { digest: entry.digest, size: String(entry.size), abi: String(entry.abi) })),
    row("setting-source", entry.revoked
      ? t("settings.catalog.revoked")
      : t("settings.catalog.permissions", { permissions: entry.permissions.join(", ") || t("settings.catalog.no_permissions") })),
  );
  item.append(details);
  const current = installed.find((plugin) => plugin.id === entry.id);
  const action = (label: string, operation: (source: string) => Promise<unknown>, requiresSource = true, danger = false) => {
    const button = document.createElement("button");
    button.type = "button";
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
    item.append(button);
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

function sectionTitle(key: Key): HTMLElement {
  const title = document.createElement("div");
  title.className = "panel-title";
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "3");
  title.textContent = t(key);
  return title;
}

function installAction(): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("div");
  label.textContent = t("settings.components.install");
  text.append(label, row("setting-source", t("settings.components.install.hint")));
  const button = document.createElement("button");
  button.type = "button";
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
  el.append(text, button);
  return el;
}

/// Un componente distribuito con Fub conserva il proprio interruttore runtime e
/// le preferenze granulari dei permessi. Il percorso installato sotto è
/// separato: l'autorità persistita è l'identità dell'installazione.
function renderComponent(bundle: BundleInfo, forKey: EntryMap): HTMLElement[] {
  const el = document.createElement("div");
  el.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = bundle.name;
  label.htmlFor = `bundle-${bundle.id}`;
  text.append(label, row("muted", `${bundle.id} · ${t(TRUST_LABELS[bundle.trust])}`));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `bundle-${bundle.id}`;
  input.checked = bundle.mounted;
  const pendingKey = `bundle:${bundle.id}`;
  input.disabled = pendingComponents.has(pendingKey);
  input.addEventListener("change", () => {
    beginComponentAction(
      pendingKey,
      [el],
      () => api.setPluginEnabled(bundle.id, input.checked),
      "settings.component_not_changed",
    );
  });
  el.append(text, input);

  const permissions = rows(bundle);
  if (permissions.length === 0) {
    return [el, row("muted setting-sub", t("settings.permissions.none"))];
  }
  const nodes = [
    el,
    sectionTitle("settings.permissions"),
    row("muted setting-sub", t("settings.permissions.hint")),
  ];
  nodes[1].classList.add("setting-sub");
  if (!bundle.mounted) {
    nodes.push(row("muted setting-sub", t("settings.permissions.off_hint")));
  }
  for (const permission of permissions) {
    nodes.push(renderPermission(permission, forKey.get(permission.key)));
  }
  return nodes;
}

const CONSENT_LABELS: Record<InstalledPluginInfo["consent"], Key> = {
  undecided: "settings.components.consent.undecided",
  denied: "settings.components.consent.denied",
  granted: "settings.components.consent.granted",
};

function renderInstalledComponent(plugin: InstalledPluginInfo, forKey: EntryMap): HTMLElement[] {
  const key = `installed:${plugin.installation}`;
  const pending = pendingComponents.has(key);
  const nodes: HTMLElement[] = [];

  const header = document.createElement("div");
  header.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const name = document.createElement("div");
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
  nodes.push(header);

  const enabledRow = document.createElement("div");
  enabledRow.className = "setting-row setting-sub";
  const enabledText = document.createElement("div");
  enabledText.className = "setting-text";
  const enabledLabel = document.createElement("label");
  const enabledId = `installed-enabled-${plugin.installation}`;
  enabledLabel.htmlFor = enabledId;
  enabledLabel.textContent = t("settings.components.enabled");
  enabledText.append(enabledLabel, row("setting-source", t("settings.components.enabled.hint")));
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.id = enabledId;
  enabled.checked = plugin.enabled;
  enabled.disabled = pending || plugin.revoked;
  enabled.addEventListener("change", () => {
    beginComponentAction(
      key,
      nodes,
      () => api.setInstalledPluginEnabled(plugin.installation, enabled.checked),
      "settings.components.enabled_failed",
    );
  });
  enabledRow.append(enabledText, enabled);
  nodes.push(enabledRow);

  const consentRow = document.createElement("div");
  consentRow.className = "setting-row setting-sub";
  const consentText = document.createElement("div");
  consentText.className = "setting-text";
  const consentLabel = document.createElement("label");
  const consentId = `installed-consent-${plugin.installation}`;
  consentLabel.htmlFor = consentId;
  consentLabel.textContent = t("settings.components.consent");
  consentText.append(consentLabel, row("setting-source", t("settings.components.consent.hint")));
  const consent = document.createElement("select");
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
  consentRow.append(consentText, consent);
  nodes.push(consentRow);

  const permissions = rows(plugin);
  nodes.push(sectionTitle("settings.permissions"));
  nodes[nodes.length - 1]!.classList.add("setting-sub");
  nodes.push(row("muted setting-sub", t("settings.components.permissions.hint")));
  if (permissions.length === 0) {
    nodes.push(row("muted setting-sub", t("settings.permissions.none")));
  } else {
    for (const permission of permissions) {
      nodes.push(renderPermission(permission, plugin.runtime_known ? forKey.get(permission.key) : undefined));
    }
  }

  const removeRow = document.createElement("div");
  removeRow.className = "setting-row setting-sub";
  const removeText = document.createElement("div");
  removeText.className = "setting-text";
  const removeLabel = document.createElement("div");
  removeLabel.textContent = t("settings.components.remove");
  removeText.append(removeLabel, row("setting-source", t("settings.components.remove.hint")));
  const remove = document.createElement("button");
  remove.type = "button";
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
  removeRow.append(removeText, remove);
  nodes.push(removeRow);
  return nodes;
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
  el.className = "setting-row setting-sub";
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
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `permission-${p.key}`;
  input.checked = granted;
  input.setAttribute("aria-label", t("settings.permission.grant", { cosa: p.message }));
  input.addEventListener("change", () => {
    void writeRow(p.key, show(input.checked), () => api.setSetting(p.key, input.checked), "settings.permission_not_changed");
  });
  el.append(input);
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
    return [row("muted", t("settings.no_vaults"))];
  }
  return vaults.map(renderVaultRow);
}

function renderVaultRow(vault: KnownVault): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  // Il nome vuoto è il nome della cartella, e lo ricava chi disegna: tenerlo
  // scritto vorrebbe dire mostrare il nome vecchio dopo una rinomina.
  label.textContent = `${vault.icon ?? ""} ${vault.name || nameFolder(vault.root)}`.trim();
  text.append(label, row("muted", vault.root));

  const open = document.createElement("button");
  open.className = "link-button";
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

  const favoriteButton = document.createElement("button");
  favoriteButton.className = "link-button";
  favoriteButton.textContent = vault.favorite ? "★" : "☆";
  setTooltip(favoriteButton, t(vault.favorite ? "settings.unfavourite" : "settings.favourite"));
  favoriteButton.addEventListener("click", () => {
    void writeVault(() => api.setVaultFavorite(vault.root, !vault.favorite));
  });

  const forget = document.createElement("button");
  forget.className = "link-button";
  forget.textContent = t("settings.forget");
  setTooltip(forget, t("settings.forget.hint"));
  forget.addEventListener("click", () => {
    void writeVault(() => api.forgetVault(vault.root));
  });

  el.append(text, favoriteButton, open, forget);
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

/// Il valore di una riga come lo scriverebbe un umano.
export function show(value: SettingValue): string {
  if (typeof value === "boolean") return t(value ? "settings.on" : "settings.off");
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : t("settings.nothing");
  return String(value);
}
