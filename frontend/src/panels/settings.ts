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
import { Race } from "../ui/race";
import { settings } from "../host/query";
import type { BundleInfo, SettingEntry, SettingValue, KnownVault } from "../host/contract";
import { onEvent } from "../state/kernel";
import { $ } from "../ui/dom";
import { trapFocus } from "../ui/a11y";
import { notify } from "../ui/notify";
import { allCommands, keybindingKey } from "../ui/commands";
import { TRUST_LABELS, isPermissionKey, rows, type PermissionRow } from "../ui/permissions";
import { errorText } from "../host/errors";
import { t, type Key } from "../i18n/strings";
import { THEME_KEY } from "../theme/theme";
import { setTooltip } from "../ui/tooltip";

/// Le righe risolte per chiave: è ciò con cui una scheda ritrova il valore di
/// una chiave che ha composto invece di leggerla da un elenco.
type EntryMap = Map<string, SettingEntry>;

/// Un gruppo del form: l'intestazione e le sue righe, nell'ordine in cui il
/// canale dati le ha date (che è l'ordine di chiave).
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

export function mountSettings(nextHooks: Hooks): void {
  settingsHooks = nextHooks;
  panelEl = $("#settings-panel");
  bodyEl = $("#settings-body");
  tabsEl = $("#settings-tabs");
  $("#open-settings").addEventListener("click", () => void open());
  $("#settings-close").addEventListener("click", () => close());
  for (const button of tabsEl.querySelectorAll<HTMLButtonElement>("button[data-tab]")) {
    button.addEventListener("click", () => {
      tab = button.dataset.tab as SettingsTab;
      void render();
    });
  }
  // Un'impostazione può cambiare **da fuori di qui**: un comando
  // (`settings.set`), un plugin, un'altra finestra. L'evento non porta il valore
  // nuovo apposta — si rilegge, che è l'unica cosa che non può invecchiare.
  onEvent("setting_changed", () => {
    if (!panelEl.hidden) void render();
  });
  // Chiudere il vault mentre il pannello è aperto lascerebbe un form che parla
  // di un vault che non c'è: le impostazioni sono per-vault.
  onEvent("vault_closed", () => close());
}

/// Come si scioglie la trappola del fuoco, quando il pannello è aperto.
///
/// È `null` a pannello chiuso, ed è il modo in cui `chiudi()` resta idempotente:
/// lo chiamano il pulsante, Escape e l'evento `vault_closed`, e senza questa
/// guardia il secondo giro rimetterebbe il fuoco dove stava *prima del primo*.
let release: (() => void) | null = null;

async function open(): Promise<void> {
  if (release) return;
  panelEl.hidden = false;
  // Il fuoco entra e resta: mentre le impostazioni sono aperte, sono quello che
  // si sta facendo (è la ragione per cui stanno sopra tutto anche visivamente,
  // scritto accanto al loro `z-index`). Una modale da cui il linguetta scappa mette
  // chi non vede a parlare con la UI sotto, che è ancora lì e non è più quella
  // che ha davanti.
  release = trapFocus(panelEl, close);
  await render();
}

function close(): void {
  panelEl.hidden = true;
  release?.();
  release = null;
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
  for (const button of tabsEl.querySelectorAll<HTMLButtonElement>("button[data-tab]")) {
    const selected = button.dataset.tab === tab;
    // La classe la vedeva chi guarda, `aria-selected` chi ascolta: erano la
    // stessa informazione detta a metà delle persone, e scritto due volte.
    // Adesso è scritto una volta sola, e la pelle legge quella.
    button.setAttribute("aria-selected", String(selected));
  }
  await race.last(async (expected) => {
    // Il `catch` sta **sulla promessa e non attorno all'attesa**, ed è la
    // differenza che questa migrazione ha reso visibile: un `try` attorno
    // all'`atteso` ingoierebbe il segnale di scadenza insieme all'errore di
    // lettura, e il giro vecchio tornerebbe a scrivere. Qui l'errore è già un
    // valore quando arriva al cancello.
    //
    // Un pannello che non riesce a leggere lo dice: il §20.2 avrà il canale
    // vero, e finché non c'è questo è il posto più visibile che ha.
    const nodes = await expected(
      tabContent().catch((e: unknown) => [
        row("muted", t("settings.read_failed", { reason: errorText(e) })),
      ]),
    );
    bodyEl.replaceChildren(...nodes);
  });
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
///
/// **Tutti i comandi**, e non più i soli comandi del kernel: da quando anche
/// quelli della shell hanno una chiave (§16.3), un filtro su `c.spec` lascerebbe
/// le sedici `keys.shell.*` in fondo alla scheda della configurazione, senza
/// gruppo e con l'id per etichetta.
function shortcutKeys(): Set<string> {
  return new Set(allCommands().map((c) => keybindingKey(c.id)));
}

async function renderForm(): Promise<HTMLElement[]> {
  const shortcuts = shortcutKeys();
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
    (e) => !shortcuts.has(e.spec.key) && !isPermissionKey(e.spec.key),
  );
  if (entries.length === 0) {
    return [row("muted", t("settings.none"))];
  }
  const nodes: HTMLElement[] = [];
  for (const group of groupEntries(entries)) {
    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = group.title;
    nodes.push(title);
    for (const entry of group.rows) nodes.push(renderRow(entry));
  }
  return nodes;
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
/// [0040]: ../../../docs/decisions/0040-chi-localizza.md
function renderRow(entry: SettingEntry, name?: string, description?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  // Il tema è la riga più guardata del gruppo Appearance: la si alza di
  // un gradino visivo, così l'occhio la trova prima delle altre impostazioni
  // di aspetto che le stanno attorno.
  if (entry.spec.key === THEME_KEY) {
    el.classList.add("setting-row--theme");
  }

  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = name ?? entry.spec.label;
  label.htmlFor = `setting-${entry.spec.key}`;
  text.append(label);
  const below = description ?? entry.spec.description;
  if (below) {
    text.append(row("muted", below));
  }
  text.append(row("setting-source", sourceLabel(entry)));

  const control = field(entry);
  el.append(text, control);

  // «Azzera» compare **solo dove c'è qualcosa da azzerare**: su una riga al
  // valore predefinito sarebbe un pulsante che non fa niente, cioè un pulsante
  // che insegna a non fidarsi dei pulsanti.
  if (entry.source !== "default") {
    const resetButton = document.createElement("button");
    resetButton.className = "link-button";
    resetButton.textContent = t("settings.reset");
    setTooltip(resetButton, t("settings.reset.hint"));
    resetButton.addEventListener("click", () => {
      void write(() => api.resetSetting(entry.spec.key));
    });
    el.append(resetButton);
  }
  return el;
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
        void write(() => api.setSetting(entry.spec.key, input.checked));
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
        void write(() => api.setSetting(entry.spec.key, n));
      });
      return input;
    }
    case "text": {
      const input = document.createElement("input");
      input.type = "text";
      input.id = id;
      input.value = String(entry.value);
      input.addEventListener("change", () => {
        void write(() => api.setSetting(entry.spec.key, input.value));
      });
      return input;
    }
    case "choice": {
      // Il tema non è una tendina: tre scelte si vedono meglio come tre
      // segmenti affiancati, e la scelta corrente si riconosce senza aprire
      // niente. È la sola chiave che si prende questa strada: qualunque altra
      // `choice` ha più di tre opzioni, o meno, o le ha ma non è la prima cosa
      // che si guarda, e per quelle la `<select>` resta giusta.
      if (entry.spec.key === THEME_KEY) {
        return themeToggle(entry, kind);
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
        void write(() => api.setSetting(entry.spec.key, select.value));
      });
      return select;
    }
    // Un elenco si **mostra e non si edita**: il protocollo di UI non ha un
    // editor di liste, e inventarne uno qui vorrebbe dire che il pannello sa
    // disegnare qualcosa che una view dichiarativa non può chiedere. Chi lo
    // cambia è il comando che lo scrive — per `plugins.disabled` è la scheda
    // «Componenti», qui accanto.
    case "list": {
      const el = row("muted", show(entry.value));
      // L'`id` c'è anche qui, e non è pignoleria: l'etichetta della riga punta
      // sempre a `setting-<key>`, e senza questo il `for` di ogni riga di
      // tipo lista sarebbe pendente.
      el.id = id;
      return el;
    }
  }
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
function themeToggle(
  entry: SettingEntry,
  kind: Extract<SettingEntry["spec"]["kind"], { kind: "choice" }>,
): HTMLElement {
  const current = String(entry.value);
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
    const selected = value === current;
    // `aria-checked` e basta: era accompagnato da una classe modificatrice, e
    // la pelle finiva per elencare quattro selettori diversi per lo stesso
    // acceso, perché nessuno sapeva quale dei quattro il markup usasse.
    btn.setAttribute("aria-checked", String(selected));
    // La scrittura è la stessa della `<select>`: `api.setSetting` con il
    // valore dell'opzione, e `write` che ridisegna. Il reset «azzera»
    // continua a funzionare perché è fuori dal campo, sulla riga.
    btn.addEventListener("click", () => {
      void write(() => api.setSetting(entry.spec.key, value));
    });
    group.append(btn);
  }
  return group;
}

/// Scrive, e ridisegna: la sourceLabel di una riga cambia insieme al valore, e
/// un form che non si ridisegnasse mostrerebbe «valore predefinito» sotto un
/// valore appena scelto.
/// `failure` è la frase da dire se non è andata: un permesso non cambiato e
/// un'impostazione non cambiata sono due cose diverse per chi legge, e dirle
/// uguali manderebbe a cercare il difetto nella scheda sbagliata.
async function write(
  action: () => Promise<void>,
  failure: Key = "settings.not_changed",
): Promise<void> {
  try {
    await action();
  } catch (e) {
    notify(t(failure, { reason: errorText(e) }), "guasto");
  }
  await render();
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

async function renderShortcuts(): Promise<HTMLElement[]> {
  const [entries, suggested] = await Promise.all([settings(), drawSuggestedKeys()]);
  const byKey = new Map(entries.map((e) => [e.spec.key, e]));
  const nodes: HTMLElement[] = [...suggested, row("muted", t("settings.shortcuts_hint"))];
  // Quanti nodi c'erano **prima** delle righe vere: il banner dei tasti proposti
  // ne aggiunge uno o nessuno, e un conto cablato direbbe «nessuna scorciatoia»
  // esattamente nel vault che ne propone.
  const header = nodes.length;
  const commands = allCommands();
  // In ordine di **comando**, non di chiave: chi cerca «Nuova nota» la cerca
  // dove la palette gliela mostra.
  for (const command of commands) {
    if (!command.spec) continue;
    const entry = byKey.get(keybindingKey(command.id));
    if (entry) nodes.push(renderRow(entry));
  }
  const fromShell = commands.filter((c) => c.run !== null);
  if (fromShell.length > 0) {
    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = t("settings.shortcuts.shell");
    nodes.push(title);
    // **Righe come le altre**, dalla 0116: la chiave che le tiene è
    // `keys.shell.*`, dichiarata dal bundle di core e di scope macchina perché
    // un comando di shell esiste prima di ogni vault. Il campo di testo, la
    // sourceLabel e l'«azzera» arrivano dalla stessa `renderRow` di tutte le
    // altre; quello che il pannello ci mette è il **nome**, che di là non c'è.
    //
    // Una riga che non arrivasse — un id in tabella che il montaggio non
    // dichiara — si salta invece di disegnare un campo che non scrive da
    // nessuna parte.
    for (const command of fromShell) {
      const entry = byKey.get(keybindingKey(command.id));
      if (entry) nodes.push(renderRow(entry, command.title, command.description));
    }
  }
  if (nodes.length === header) nodes.push(row("muted", t("settings.shortcuts.none")));
  return nodes;
}

// --- la scheda dei componenti -----------------------------------------------

async function renderComponents(): Promise<HTMLElement[]> {
  // Le due domande insieme, e non una per componente: i permessi sono
  // impostazioni come le altre, quindi arrivano tutti dalla stessa risposta che
  // il pannello già chiedeva. Chiederne una per componente sarebbe N chiamate
  // per disegnare una scheda.
  const [bundles, entries] = await Promise.all([api.listBundles(), settings()]);
  const forKey = new Map(entries.map((e) => [e.spec.key, e]));
  return [
    row("muted", t("settings.components_hint")),
    ...bundles.flatMap((b) => renderComponent(b, forKey)),
  ];
}

/// Un componente: la sua riga, e sotto ciò che ha dichiarato di voler fare.
///
/// Torna **più** nodi e non un blocco annidato perché le righe dei permessi
/// sono righe di impostazione come tutte le altre — stessa classe, stessa
/// colonna del controllo — e infilarle dentro un contenitore proprio le
/// allineerebbe diversamente da ogni altra casella di questo pannello.
function renderComponent(bundle: BundleInfo, forKey: EntryMap): HTMLElement[] {
  const el = document.createElement("div");
  el.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = bundle.name;
  label.htmlFor = `bundle-${bundle.id}`;
  // Di chi ci si sta fidando sta accanto all'id e non fra i permessi: è la
  // premessa con cui si leggono, non una riga dell'elenco.
  text.append(label, row("muted", `${bundle.id} · ${t(TRUST_LABELS[bundle.trust])}`));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `bundle-${bundle.id}`;
  input.checked = bundle.mounted;
  input.addEventListener("change", () => {
    void (async () => {
      try {
        // Ciò che torna sono gli errori **dello spegnimento**, che non sono un
        // motivo per non spegnere: si dicono e basta. Arrivano interi — specie
        // e frase (decisione 0041) — e qui si stampa la frase con la stessa
        // funzione di ogni altro guasto: `${p}` su un oggetto direbbe
        // «[object Object]», ed è il tipo a non lasciarlo scrivere.
        const errors = await api.setPluginEnabled(bundle.id, input.checked);
        for (const p of errors) notify(errorText(p), "guasto");
        // Il montaggio è già avvenuto lato host; qui si riallinea **il resto
        // della finestra**, o le view di un componente spento resterebbero
        // appese nella sidebar e i suoi comandi nella palette.
        await settingsHooks.reloadProvider();
      } catch (e) {
        notify(t("settings.component_not_changed", { reason: errorText(e) }), "guasto");
      }
      await render();
    })();
  });
  el.append(text, input);

  const permissions = rows(bundle);
  if (permissions.length === 0) {
    return [el, row("muted setting-sub", t("settings.permissions.none"))];
  }
  const title = document.createElement("div");
  title.className = "panel-title setting-sub";
  title.textContent = t("settings.permissions");
  const nodes = [el, title, row("muted setting-sub", t("settings.permissions.hint"))];
  // Un componente **spento** non è dichiarato nel kernel, quindi le chiavi con
  // cui si negano i suoi permessi non esistono: si legge cosa chiederebbe, e
  // per deciderlo lo si accende. Dirlo è meglio che mostrare interruttori che
  // non risponderebbero — e mostrare l'elenco lo stesso è il punto, perché
  // «cosa chiederebbe se lo accendessi» è una domanda che ci si pone **prima**.
  if (!bundle.mounted) {
    nodes.push(row("muted setting-sub", t("settings.permissions.off_hint")));
  }
  for (const p of permissions) nodes.push(renderPermission(p, forKey.get(p.key)));
  return nodes;
}

/// Una riga di permesso: la frase, il suo parametro, e l'interruttore.
///
/// L'interruttore c'è solo quando c'è qualcosa da negare — cioè quando l'host
/// conosce il permesso **e** il componente è acceso, che è quando la chiave è
/// dichiarata. Un interruttore che non risponde insegna a non fidarsi degli
/// interruttori, ed è la stessa riga con cui questo pannello nasconde «azzera»
/// dove non c'è niente da azzerare.
function renderPermission(p: PermissionRow, entry: SettingEntry | undefined): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row setting-sub";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = p.message;
  label.htmlFor = `permission-${p.key}`;
  text.append(label);
  if (p.detail) text.append(row("setting-source", p.detail));
  el.append(text);

  if (!p.known || !entry) return el;

  const granted = entry.value !== false;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `permission-${p.key}`;
  input.checked = granted;
  // La frase è già l'etichetta visibile, ma è lunga e comincia tutta uguale
  // («Può leggere…»): chi ascolta la lista dei controlli sentirebbe undici
  // caselle che si somigliano. Il nome accessibile porta quindi la frase
  // dentro una che dice cosa fa la casella.
  input.setAttribute("aria-label", t("settings.permission.grant", { thing: p.message }));
  input.addEventListener("change", () => {
    void write(() => api.setSetting(p.key, input.checked), "settings.permission_not_changed");
  });
  el.append(input);
  // Che sia stato **l'utente** a toglierlo è l'informazione che distingue «non
  // lo chiede» da «gliel'ho tolto io», e senza di essa una riga spenta si legge
  // come una riga che il componente non ha dichiarato.
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
