// **Il pannello delle impostazioni** (§11.1): il posto che questa shell non
// aveva, e che `ui/views.ts` dichiarava mancante da tre sedute
// («questa shell non ha ancora un pannello di impostazioni (§11.1)»).
//
// # Il form lo genera la shell, e lo schema lo dichiara chi lo possiede
//
// Nessun id cablato qui dentro: si chiede al canale dati com'è configurato
// questo vault (`impostazioni()`, `IndexQuery::Settings`) e si disegna ciò che
// torna — chiave, etichetta, prosa, gruppo, specie e provenienza. Un'impostazione
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
import { Corsa } from "../ui/corsa";
import { impostazioni } from "../host/query";
import type { BundleInfo, SettingEntry, SettingValue, KnownVault } from "../host/contract";
import { onEvent } from "../state/kernel";
import { $ } from "../ui/dom";
import { intrappolaFuoco } from "../ui/a11y";
import { notify } from "../ui/notify";
import { allCommands, keybindingKey } from "../ui/commands";
import { FIDUCIA, isPermissionKey, righe, type RigaPermesso } from "../ui/permessi";
import { errorText } from "../host/errors";
import { t, type Chiave } from "../i18n/strings";
import { CHIAVE_TEMA } from "../theme/theme";

/// Le righe risolte per chiave: è ciò con cui una scheda ritrova il valore di
/// una chiave che ha composto invece di leggerla da un elenco.
type Mappa = Map<string, SettingEntry>;

/// Un gruppo del form: l'intestazione e le sue righe, nell'ordine in cui il
/// canale dati le ha date (che è l'ordine di chiave).
export interface Gruppo {
  titolo: string;
  righe: SettingEntry[];
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
export function raggruppa(entries: SettingEntry[]): Gruppo[] {
  const gruppi: Gruppo[] = [];
  const sciolte: SettingEntry[] = [];
  for (const entry of entries) {
    if (entry.spec.group === "") {
      sciolte.push(entry);
      continue;
    }
    const esistente = gruppi.find((g) => g.titolo === entry.spec.group);
    if (esistente) esistente.righe.push(entry);
    else gruppi.push({ titolo: entry.spec.group, righe: [entry] });
  }
  if (sciolte.length > 0) gruppi.push({ titolo: t("settings.group.other"), righe: sciolte });
  return gruppi;
}

/// Cosa dire sotto una riga a proposito di **dove** vive il suo valore.
///
/// È l'informazione che un utente non ha modo di dedurre e che decide se quel
/// che sta per cambiare viaggerà col vault: senza, un'impostazione di macchina e
/// una del vault si toccano allo stesso modo e si comportano diversamente su
/// un'altra macchina.
export function provenienza(entry: SettingEntry): string {
  const dove = t(entry.spec.scope === "machine" ? "settings.scope.machine" : "settings.scope.vault");
  switch (entry.source) {
    case "default":
      return t("settings.source.default", { dove });
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
export interface Ganci {
  /// Apre un vault e ricostruisce la shell attorno, come farebbe il selettore
  /// di cartella.
  apriVault(root: string): Promise<void>;
  /// Riscopre view e comandi. Serve dopo aver acceso o spento un componente:
  /// `set_plugin_enabled` monta e smonta **subito** lato host, ma la scoperta
  /// gira solo all'apertura del vault — senza questa chiamata le view di un
  /// plugin spento resterebbero appese nella sidebar, e quelle di uno appena
  /// acceso non comparirebbero fino al riavvio.
  ricaricaProvider(): Promise<void>;
}

let ganci: Ganci;

/// Le schede che questo pannello ospita. `views` è la superficie
/// `settings_tab` del contratto (§2.2): la dichiarano le view, e finora questa
/// shell non aveva dove metterle.
type Scheda = "impostazioni" | "componenti" | "scorciatoie" | "vault";

let scheda: Scheda = "impostazioni";

export function mountSettings(hooks: Ganci): void {
  ganci = hooks;
  panelEl = $("#settings-panel");
  bodyEl = $("#settings-body");
  tabsEl = $("#settings-tabs");
  $("#open-settings").addEventListener("click", () => void apri());
  $("#settings-close").addEventListener("click", () => chiudi());
  for (const bottone of tabsEl.querySelectorAll<HTMLButtonElement>("button[data-scheda]")) {
    bottone.addEventListener("click", () => {
      scheda = bottone.dataset.scheda as Scheda;
      void disegna();
    });
  }
  // Un'impostazione può cambiare **da fuori di qui**: un comando
  // (`settings.set`), un plugin, un'altra finestra. L'evento non porta il valore
  // nuovo apposta — si rilegge, che è l'unica cosa che non può invecchiare.
  onEvent("setting_changed", () => {
    if (!panelEl.hidden) void disegna();
  });
  // Chiudere il vault mentre il pannello è aperto lascerebbe un form che parla
  // di un vault che non c'è: le impostazioni sono per-vault.
  onEvent("vault_closed", () => chiudi());
}

/// Come si scioglie la trappola del fuoco, quando il pannello è aperto.
///
/// È `null` a pannello chiuso, ed è il modo in cui `chiudi()` resta idempotente:
/// lo chiamano il pulsante, Escape e l'evento `vault_closed`, e senza questa
/// guardia il secondo giro rimetterebbe il fuoco dove stava *prima del primo*.
let sciogli: (() => void) | null = null;

async function apri(): Promise<void> {
  if (sciogli) return;
  panelEl.hidden = false;
  // Il fuoco entra e resta: mentre le impostazioni sono aperte, sono quello che
  // si sta facendo (è la ragione per cui stanno sopra tutto anche visivamente,
  // scritta accanto al loro `z-index`). Una modale da cui il tab scappa mette
  // chi non vede a parlare con la UI sotto, che è ancora lì e non è più quella
  // che ha davanti.
  sciogli = intrappolaFuoco(panelEl, chiudi);
  await disegna();
}

function chiudi(): void {
  panelEl.hidden = true;
  sciogli?.();
  sciogli = null;
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
const corsa = new Corsa();

async function disegna(): Promise<void> {
  for (const bottone of tabsEl.querySelectorAll<HTMLButtonElement>("button[data-scheda]")) {
    const scelta = bottone.dataset.scheda === scheda;
    bottone.classList.toggle("active", scelta);
    // La classe la vede chi guarda, `aria-selected` chi ascolta: erano la
    // stessa informazione detta a metà delle persone.
    bottone.setAttribute("aria-selected", String(scelta));
  }
  await corsa.ultimo(async (atteso) => {
    // Il `catch` sta **sulla promessa e non attorno all'attesa**, ed è la
    // differenza che questa migrazione ha reso visibile: un `try` attorno
    // all'`atteso` ingoierebbe il segnale di scadenza insieme all'errore di
    // lettura, e il giro vecchio tornerebbe a scrivere. Qui l'errore è già un
    // valore quando arriva al cancello.
    //
    // Un pannello che non riesce a leggere lo dice: il §20.2 avrà il canale
    // vero, e finché non c'è questo è il posto più visibile che ha.
    const nodi = await atteso(
      contenutoDellaScheda().catch((e: unknown) => [
        riga("muted", t("settings.read_failed", { reason: errorText(e) })),
      ]),
    );
    bodyEl.replaceChildren(...nodi);
  });
}

function contenutoDellaScheda(): Promise<HTMLElement[]> {
  if (scheda === "impostazioni") return disegnaForm();
  if (scheda === "componenti") return disegnaComponenti();
  if (scheda === "scorciatoie") return disegnaScorciatoie();
  return disegnaVault();
}

// --- la scheda delle impostazioni -------------------------------------------

/// Le chiavi che sono **scorciatoie**, e non righe di configurazione.
///
/// Non si riconoscono dal prefisso della chiave — sarebbe indovinare — ma
/// componendole: per ogni comando si sa quale chiave gli è stata fabbricata,
/// perché la regola è una sola e sta scritta in `keybindingKey` (§18.2). È la
/// stessa mossa con cui questa shell riconosce qualunque altra cosa attraversi
/// il confine: rifà il conto invece di leggere una convenzione.
///
/// **Tutti i comandi**, e non più i soli comandi del kernel: da quando anche
/// quelli della shell hanno una chiave (§16.3), un filtro su `c.spec` lascerebbe
/// le sedici `keys.shell.*` in fondo alla scheda della configurazione, senza
/// gruppo e con l'id per etichetta.
function chiaviDelleScorciatoie(): Set<string> {
  return new Set(allCommands().map((c) => keybindingKey(c.id)));
}

async function disegnaForm(): Promise<HTMLElement[]> {
  const scorciatoie = chiaviDelleScorciatoie();
  // Le scorciatoie **non stanno qui**: sono impostazioni come le altre, e
  // proprio per questo sarebbero venti righe senza gruppo in fondo alla scheda
  // della configurazione. Hanno una scheda loro, ed è la stessa forma — un
  // campo di testo, una provenienza, un «azzera» — perché è la stessa cosa.
  // E nemmeno i **permessi** (§23.17), per la stessa ragione e con lo stesso
  // conto rifatto: sono impostazioni come le altre, quindi finirebbero qui
  // come settanta righe senza gruppo la cui etichetta è una chiave nuda. Le
  // disegna la scheda dei componenti, accanto a chi le ha chieste, che è
  // l'unico posto in cui significano qualcosa.
  const entries = (await impostazioni()).filter(
    (e) => !scorciatoie.has(e.spec.key) && !isPermissionKey(e.spec.key),
  );
  if (entries.length === 0) {
    return [riga("muted", t("settings.none"))];
  }
  const nodi: HTMLElement[] = [];
  for (const gruppo of raggruppa(entries)) {
    const titolo = document.createElement("div");
    titolo.className = "panel-title";
    titolo.textContent = gruppo.titolo;
    nodi.push(titolo);
    for (const entry of gruppo.righe) nodi.push(disegnaRiga(entry));
  }
  return nodi;
}

/// Una riga di impostazione.
///
/// `nome` sostituisce l'etichetta dichiarata, e c'è per una sola famiglia: le
/// scorciatoie dei comandi **della shell** (§16.3). La loro chiave la dichiara
/// il bundle di core, che il titolo del comando non ce l'ha — la frase la
/// localizza chi l'ha scritta ([0040]), e chi ha scritto «Apri il pannello dei
/// file» è questa shell. Passarlo di qua costa un parametro; portarne una copia
/// di là costerebbe trentaquattro stringhe tradotte due volte.
///
/// [0040]: ../../../docs/decisions/0040-chi-localizza.md
function disegnaRiga(entry: SettingEntry, nome?: string, descrizione?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  // Il tema è la riga più guardata del gruppo Appearance: la si alza di
  // un gradino visivo, così l'occhio la trova prima delle altre impostazioni
  // di aspetto che le stanno attorno.
  if (entry.spec.key === CHIAVE_TEMA) {
    el.classList.add("setting-row--theme");
  }

  const testo = document.createElement("div");
  testo.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = nome ?? entry.spec.label;
  label.htmlFor = `setting-${entry.spec.key}`;
  testo.append(label);
  const sotto = descrizione ?? entry.spec.description;
  if (sotto) {
    testo.append(riga("muted", sotto));
  }
  testo.append(riga("setting-source", provenienza(entry)));

  const controllo = campo(entry);
  el.append(testo, controllo);

  // «Azzera» compare **solo dove c'è qualcosa da azzerare**: su una riga al
  // valore predefinito sarebbe un pulsante che non fa niente, cioè un pulsante
  // che insegna a non fidarsi dei pulsanti.
  if (entry.source !== "default") {
    const azzera = document.createElement("button");
    azzera.className = "link-button";
    azzera.textContent = t("settings.reset");
    azzera.title = t("settings.reset.hint");
    azzera.addEventListener("click", () => {
      void scrivi(() => api.resetSetting(entry.spec.key));
    });
    el.append(azzera);
  }
  return el;
}

/// Il campo di una riga, dalla **specie dichiarata**.
///
/// Un caso per specie e nessun default: una specie nuova nel contratto arriva
/// qui come errore di compilazione (`mirror.test.ts` la ferma prima), non come
/// una riga che il pannello salta in silenzio.
function campo(entry: SettingEntry): HTMLElement {
  const id = `setting-${entry.spec.key}`;
  const kind = entry.spec.kind;
  switch (kind.kind) {
    case "toggle": {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.checked = entry.value === true;
      input.addEventListener("change", () => {
        void scrivi(() => api.setSetting(entry.spec.key, input.checked));
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
        void scrivi(() => api.setSetting(entry.spec.key, n));
      });
      return input;
    }
    case "text": {
      const input = document.createElement("input");
      input.type = "text";
      input.id = id;
      input.value = String(entry.value);
      input.addEventListener("change", () => {
        void scrivi(() => api.setSetting(entry.spec.key, input.value));
      });
      return input;
    }
    case "choice": {
      // Il tema non è una tendina: tre scelte si vedono meglio come tre
      // segmenti affiancati, e la scelta corrente si riconosce senza aprire
      // niente. È la sola chiave che si prende questa strada: qualunque altra
      // `choice` ha più di tre opzioni, o meno, o le ha ma non è la prima cosa
      // che si guarda, e per quelle la `<select>` resta giusta.
      if (entry.spec.key === CHIAVE_TEMA) {
        return interruttoreTema(entry, kind);
      }
      const select = document.createElement("select");
      select.id = id;
      // Il valore corrente potrebbe **non essere fra le opzioni**: un
      // `settings.json` scritto a mano, o uno schema che ha cambiato le proprie
      // scelte fra due versioni del plugin. Senza questa riga nessuna `option`
      // risulterebbe scelta e il browser mostrerebbe la prima — cioè un valore
      // falso, che è peggio di un valore strano.
      const corrente = String(entry.value);
      if (!kind.options.some((o) => o.value === corrente)) {
        const fuori = document.createElement("option");
        fuori.value = corrente;
        fuori.textContent = t("settings.off_choices", { value: corrente });
        fuori.selected = true;
        select.append(fuori);
      }
      for (const opzione of kind.options) {
        const el = document.createElement("option");
        el.value = opzione.value;
        el.textContent = opzione.label;
        el.selected = opzione.value === entry.value;
        select.append(el);
      }
      select.addEventListener("change", () => {
        void scrivi(() => api.setSetting(entry.spec.key, select.value));
      });
      return select;
    }
    // Un elenco si **mostra e non si edita**: il protocollo di UI non ha un
    // editor di liste, e inventarne uno qui vorrebbe dire che il pannello sa
    // disegnare qualcosa che una view dichiarativa non può chiedere. Chi lo
    // cambia è il comando che lo scrive — per `plugins.disabled` è la scheda
    // «Componenti», qui accanto.
    case "list": {
      const el = riga("muted", mostra(entry.value));
      // L'`id` c'è anche qui, e non è pignoleria: l'etichetta della riga punta
      // sempre a `setting-<chiave>`, e senza questo il `for` di ogni riga di
      // tipo lista sarebbe pendente.
      el.id = id;
      return el;
    }
  }
}

/// Il tema come segmented control: tre bottoni — sistema, chiaro, scuro —
/// invece di una tendina.
///
/// Le etichette sono quelle che lo schema della Choice porta già dal kernel:
/// l'`option.label` è localizzata là (0040), e ricopiarla qui vorrebbe dire
/// mantenere due traduzioni della stessa frase. Se l'opzione manca — un kernel
/// che non la dichiarasse — si mostra il valore nudo: ripiego difensivo, non
/// la strada.
function interruttoreTema(
  entry: SettingEntry,
  kind: Extract<SettingEntry["spec"]["kind"], { kind: "choice" }>,
): HTMLElement {
  const corrente = String(entry.value);
  // I tre valori che il tema conosce, nell'ordine in cui si leggono:
  // «come il sistema» (stringa vuota), poi chiaro, poi scuro.
  const attesi = ["", "light", "dark"] as const;
  const group = document.createElement("div");
  group.className = "theme-switch";
  group.id = `setting-${entry.spec.key}`;
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", entry.spec.label);
  for (const valore of attesi) {
    // L'etichetta viene dall'`option` dello schema, che il kernel localizza
    // già (0040): ricopiarla qui vorrebbe dire due traduzioni della stessa
    // frase. Se l'opzione manca — un kernel che non la dichiarasse — si
    // mostra il valore nudo: è un ripiego difensivo, non la strada.
    const op = kind.options.find((o) => o.value === valore);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-switch__segment";
    btn.setAttribute("role", "radio");
    btn.textContent = op ? op.label : valore || "system";
    const scelto = valore === corrente;
    btn.setAttribute("aria-checked", String(scelto));
    if (scelto) btn.classList.add("theme-switch__segment--active");
    // La scrittura è la stessa della `<select>`: `api.setSetting` con il
    // valore dell'opzione, e `scrivi` che ridisegna. Il reset «azzera»
    // continua a funzionare perché è fuori dal campo, sulla riga.
    btn.addEventListener("click", () => {
      void scrivi(() => api.setSetting(entry.spec.key, valore));
    });
    group.append(btn);
  }
  return group;
}

/// Scrive, e ridisegna: la provenienza di una riga cambia insieme al valore, e
/// un form che non si ridisegnasse mostrerebbe «valore predefinito» sotto un
/// valore appena scelto.
/// `guasto` è la frase da dire se non è andata: un permesso non cambiato e
/// un'impostazione non cambiata sono due cose diverse per chi legge, e dirle
/// uguali manderebbe a cercare il difetto nella scheda sbagliata.
async function scrivi(
  azione: () => Promise<void>,
  guasto: Chiave = "settings.not_changed",
): Promise<void> {
  try {
    await azione();
  } catch (e) {
    notify(t(guasto, { reason: errorText(e) }), "guasto");
  }
  await disegna();
}

// --- la scheda delle scorciatoie (§18.2) ------------------------------------
//
// Questa scheda **non ha un pannello suo**: è la scheda della configurazione con
// un filtro, e disegna le sue righe con la stessa `disegnaRiga` di tutte le
// altre. È la conseguenza di aver deciso che una scorciatoia è una chiave di
// impostazione e non un formato nuovo: il campo di testo, il «vale per questo
// vault» e l'«azzera» ci sono già, e nessuno li ha scritti due volte.

/// **Ciò che il vault propone e nessuno ha guardato** (§23.13), in cima alla
/// scheda: quante sono, su quali comandi, e le due risposte.
///
/// Sta qui e non in un dialogo all'apertura per una ragione che il verbale
/// scrive: un momento di accettazione senza niente da guardare insegna a
/// cliccare «accetto». Qui sotto ci sono le righe vere — la combinazione, la
/// provenienza, l'«azzera» — quindi rispondere è una cosa che si fa **dopo**
/// aver visto, e chi non risponde non perde niente: finché non lo fa, quelle
/// combinazioni non premono.
async function disegnaTastiProposti(): Promise<HTMLElement[]> {
  // Il banner è un **di più**, e chi non riesce a dirlo non deve portarsi via la
  // scheda: questa chiamata può fallire per conto suo — nessun vault aperto, o
  // il registro dei vault che non si legge — e da dentro la `Promise.all` di
  // `disegnaScorciatoie` un rifiuto sostituirebbe tutte le scorciatoie con
  // «non si è riusciti a leggere». È lo stesso silenzio di
  // `avvisaSeIlVaultPortaTasti` in `main.ts`, e per la stessa ragione: ciò che
  // si perde è la domanda, non il presidio — le chiavi restano sospese finché
  // qualcuno non risponde.
  const proposti = await api.pendingKeybindings().catch((): Record<string, string> => ({}));
  const chiavi = Object.keys(proposti);
  if (chiavi.length === 0) return [];

  const perChiave = new Map(allCommands().map((c) => [keybindingKey(c.id), c.title]));
  const box = document.createElement("div");
  box.className = "settings-banner";
  box.append(riga("panel-title", t("settings.vault_keys.title", { count: chiavi.length })));
  box.append(riga("muted", t("settings.vault_keys.hint")));
  for (const chiave of chiavi) {
    const el = document.createElement("div");
    el.className = "setting-row";
    const testo = document.createElement("div");
    testo.className = "setting-text";
    const label = document.createElement("label");
    // Il titolo del comando, e la chiave nuda solo se questo montaggio quel
    // comando non ce l'ha. Non dovrebbe capitare — l'host le filtra a chi non è
    // dichiarato — e scriverlo comunque costa una riga e non lascia una casella
    // vuota il giorno che la filtrata cambia.
    label.textContent = perChiave.get(chiave) ?? chiave;
    testo.append(label);
    const kbd = document.createElement("kbd");
    kbd.textContent = proposti[chiave] ?? "";
    el.append(testo, kbd);
    box.append(el);
  }

  const azioni = document.createElement("div");
  azioni.className = "settings-banner-actions";
  const adotta = document.createElement("button");
  adotta.className = "primary";
  adotta.textContent = t("settings.vault_keys.adopt");
  adotta.addEventListener("click", () => void scrivi(() => api.adoptKeybindings()));
  const rifiuta = document.createElement("button");
  rifiuta.textContent = t("settings.vault_keys.discard");
  rifiuta.title = t("settings.vault_keys.discard.hint");
  rifiuta.addEventListener("click", () => void scrivi(() => api.discardKeybindings()));
  azioni.append(adotta, rifiuta);
  box.append(azioni);
  return [box];
}

async function disegnaScorciatoie(): Promise<HTMLElement[]> {
  const [entries, proposti] = await Promise.all([impostazioni(), disegnaTastiProposti()]);
  const per_chiave = new Map(entries.map((e) => [e.spec.key, e]));
  const nodi: HTMLElement[] = [...proposti, riga("muted", t("settings.shortcuts_hint"))];
  // Quanti nodi c'erano **prima** delle righe vere: il banner dei tasti proposti
  // ne aggiunge uno o nessuno, e un conto cablato direbbe «nessuna scorciatoia»
  // esattamente nel vault che ne propone.
  const intestazione = nodi.length;
  const comandi = allCommands();
  // In ordine di **comando**, non di chiave: chi cerca «Nuova nota» la cerca
  // dove la palette gliela mostra.
  for (const comando of comandi) {
    if (!comando.spec) continue;
    const entry = per_chiave.get(keybindingKey(comando.id));
    if (entry) nodi.push(disegnaRiga(entry));
  }
  const di_shell = comandi.filter((c) => c.run !== null);
  if (di_shell.length > 0) {
    const titolo = document.createElement("div");
    titolo.className = "panel-title";
    titolo.textContent = t("settings.shortcuts.shell");
    nodi.push(titolo);
    // **Righe come le altre**, dalla 0116: la chiave che le tiene è
    // `keys.shell.*`, dichiarata dal bundle di core e di scope macchina perché
    // un comando di shell esiste prima di ogni vault. Il campo di testo, la
    // provenienza e l'«azzera» arrivano dalla stessa `disegnaRiga` di tutte le
    // altre; quello che il pannello ci mette è il **nome**, che di là non c'è.
    //
    // Una riga che non arrivasse — un id in tabella che il montaggio non
    // dichiara — si salta invece di disegnare un campo che non scrive da
    // nessuna parte.
    for (const comando of di_shell) {
      const entry = per_chiave.get(keybindingKey(comando.id));
      if (entry) nodi.push(disegnaRiga(entry, comando.title, comando.description));
    }
  }
  if (nodi.length === intestazione) nodi.push(riga("muted", t("settings.shortcuts.none")));
  return nodi;
}

// --- la scheda dei componenti -----------------------------------------------

async function disegnaComponenti(): Promise<HTMLElement[]> {
  // Le due domande insieme, e non una per componente: i permessi sono
  // impostazioni come le altre, quindi arrivano tutti dalla stessa risposta che
  // il pannello già chiedeva. Chiederne una per componente sarebbe N chiamate
  // per disegnare una scheda.
  const [bundles, entries] = await Promise.all([api.listBundles(), impostazioni()]);
  const perChiave = new Map(entries.map((e) => [e.spec.key, e]));
  return [
    riga("muted", t("settings.components_hint")),
    ...bundles.flatMap((b) => disegnaComponente(b, perChiave)),
  ];
}

/// Un componente: la sua riga, e sotto ciò che ha dichiarato di voler fare.
///
/// Torna **più** nodi e non un blocco annidato perché le righe dei permessi
/// sono righe di impostazione come tutte le altre — stessa classe, stessa
/// colonna del controllo — e infilarle dentro un contenitore proprio le
/// allineerebbe diversamente da ogni altra casella di questo pannello.
function disegnaComponente(bundle: BundleInfo, perChiave: Mappa): HTMLElement[] {
  const el = document.createElement("div");
  el.className = "setting-row";
  const testo = document.createElement("div");
  testo.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = bundle.name;
  label.htmlFor = `bundle-${bundle.id}`;
  // Di chi ci si sta fidando sta accanto all'id e non fra i permessi: è la
  // premessa con cui si leggono, non una riga dell'elenco.
  testo.append(label, riga("muted", `${bundle.id} · ${t(FIDUCIA[bundle.trust])}`));
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
        const problemi = await api.setPluginEnabled(bundle.id, input.checked);
        for (const p of problemi) notify(errorText(p), "guasto");
        // Il montaggio è già avvenuto lato host; qui si riallinea **il resto
        // della finestra**, o le view di un componente spento resterebbero
        // appese nella sidebar e i suoi comandi nella palette.
        await ganci.ricaricaProvider();
      } catch (e) {
        notify(t("settings.component_not_changed", { reason: errorText(e) }), "guasto");
      }
      await disegna();
    })();
  });
  el.append(testo, input);

  const permessi = righe(bundle);
  if (permessi.length === 0) {
    return [el, riga("muted setting-sub", t("settings.permissions.none"))];
  }
  const titolo = document.createElement("div");
  titolo.className = "panel-title setting-sub";
  titolo.textContent = t("settings.permissions");
  const nodi = [el, titolo, riga("muted setting-sub", t("settings.permissions.hint"))];
  // Un componente **spento** non è dichiarato nel kernel, quindi le chiavi con
  // cui si negano i suoi permessi non esistono: si legge cosa chiederebbe, e
  // per deciderlo lo si accende. Dirlo è meglio che mostrare interruttori che
  // non risponderebbero — e mostrare l'elenco lo stesso è il punto, perché
  // «cosa chiederebbe se lo accendessi» è una domanda che ci si pone **prima**.
  if (!bundle.mounted) {
    nodi.push(riga("muted setting-sub", t("settings.permissions.off_hint")));
  }
  for (const p of permessi) nodi.push(disegnaPermesso(p, perChiave.get(p.chiave)));
  return nodi;
}

/// Una riga di permesso: la frase, il suo parametro, e l'interruttore.
///
/// L'interruttore c'è solo quando c'è qualcosa da negare — cioè quando l'host
/// conosce il permesso **e** il componente è acceso, che è quando la chiave è
/// dichiarata. Un interruttore che non risponde insegna a non fidarsi degli
/// interruttori, ed è la stessa riga con cui questo pannello nasconde «azzera»
/// dove non c'è niente da azzerare.
function disegnaPermesso(p: RigaPermesso, entry: SettingEntry | undefined): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row setting-sub";
  const testo = document.createElement("div");
  testo.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = p.frase;
  label.htmlFor = `permission-${p.chiave}`;
  testo.append(label);
  if (p.dettaglio) testo.append(riga("setting-source", p.dettaglio));
  el.append(testo);

  if (!p.noto || !entry) return el;

  const concesso = entry.value !== false;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `permission-${p.chiave}`;
  input.checked = concesso;
  // La frase è già l'etichetta visibile, ma è lunga e comincia tutta uguale
  // («Può leggere…»): chi ascolta la lista dei controlli sentirebbe undici
  // caselle che si somigliano. Il nome accessibile porta quindi la frase
  // dentro una che dice cosa fa la casella.
  input.setAttribute("aria-label", t("settings.permission.grant", { cosa: p.frase }));
  input.addEventListener("change", () => {
    void scrivi(() => api.setSetting(p.chiave, input.checked), "settings.permission_not_changed");
  });
  el.append(input);
  // Che sia stato **l'utente** a toglierlo è l'informazione che distingue «non
  // lo chiede» da «gliel'ho tolto io», e senza di essa una riga spenta si legge
  // come una riga che il componente non ha dichiarato.
  if (!concesso) testo.append(riga("setting-source", t("settings.permission.denied")));
  return el;
}

// --- la scheda dei vault conosciuti -----------------------------------------

async function disegnaVault(): Promise<HTMLElement[]> {
  const vaults = await api.knownVaults();
  if (vaults.length === 0) {
    return [riga("muted", t("settings.no_vaults"))];
  }
  return vaults.map(disegnaVaultRiga);
}

function disegnaVaultRiga(vault: KnownVault): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  const testo = document.createElement("div");
  testo.className = "setting-text";
  const label = document.createElement("label");
  // Il nome vuoto è il nome della cartella, e lo ricava chi disegna: tenerlo
  // scritto vorrebbe dire mostrare il nome vecchio dopo una rinomina.
  label.textContent = `${vault.icon ?? ""} ${vault.name || nomeCartella(vault.root)}`.trim();
  testo.append(label, riga("muted", vault.root));

  const apri = document.createElement("button");
  apri.className = "link-button";
  apri.textContent = t("settings.open");
  apri.addEventListener("click", () => {
    void (async () => {
      try {
        // La strada è **quella di `main.ts`** e non un `openVault` seguito da
        // un reload: ricaricare rimette la shell nello stato iniziale, e lo
        // stato iniziale si ricostruisce da `FUB_VAULT` — che quasi sempre
        // non c'è. Il backend avrebbe il vault aperto e la finestra sarebbe
        // vuota, senza nemmeno un modo di dirlo.
        await ganci.apriVault(vault.root);
        chiudi();
      } catch (e) {
        notify(t("settings.open_failed", { reason: errorText(e) }), "guasto");
      }
    })();
  });

  const preferito = document.createElement("button");
  preferito.className = "link-button";
  preferito.textContent = vault.favorite ? "★" : "☆";
  preferito.title = t(vault.favorite ? "settings.unfavourite" : "settings.favourite");
  preferito.addEventListener("click", () => {
    void scriviVault(() => api.setVaultFavorite(vault.root, !vault.favorite));
  });

  const dimentica = document.createElement("button");
  dimentica.className = "link-button";
  dimentica.textContent = t("settings.forget");
  dimentica.title = t("settings.forget.hint");
  dimentica.addEventListener("click", () => {
    void scriviVault(() => api.forgetVault(vault.root));
  });

  el.append(testo, preferito, apri, dimentica);
  return el;
}

async function scriviVault(azione: () => Promise<void>): Promise<void> {
  try {
    await azione();
  } catch (e) {
    notify(t("settings.registry_failed", { reason: errorText(e) }), "guasto");
  }
  await disegna();
}

function nomeCartella(root: string): string {
  const parti = root.split(/[\\/]/).filter((p) => p !== "");
  return parti[parti.length - 1] ?? root;
}

function riga(className: string, testo: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = testo;
  return el;
}

/// Il valore di una riga come lo scriverebbe un umano.
export function mostra(value: SettingValue): string {
  if (typeof value === "boolean") return t(value ? "settings.on" : "settings.off");
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : t("settings.nothing");
  return String(value);
}
