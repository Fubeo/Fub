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
import { impostazioni } from "../host/query";
import type { BundleInfo, SettingEntry, SettingValue, VaultEntry } from "../host/contract";
import { onEvent } from "../state/kernel";
import { $ } from "../ui/dom";
import { notify } from "../ui/notify";
import { errorText } from "../host/errors";

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
  if (sciolte.length > 0) gruppi.push({ titolo: "Altro", righe: sciolte });
  return gruppi;
}

/// Cosa dire sotto una riga a proposito di **dove** vive il suo valore.
///
/// È l'informazione che un utente non ha modo di dedurre e che decide se quel
/// che sta per cambiare viaggerà col vault: senza, un'impostazione di macchina e
/// una del vault si toccano allo stesso modo e si comportano diversamente su
/// un'altra macchina.
export function provenienza(entry: SettingEntry): string {
  const dove = entry.spec.scope === "machine" ? "questa macchina" : "questo vault";
  switch (entry.source) {
    case "default":
      return `valore predefinito · vale per ${dove}`;
    case "machine":
      return "scelto per questa macchina";
    case "vault":
      return "scelto per questo vault";
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
type Scheda = "impostazioni" | "componenti" | "vault";

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

async function apri(): Promise<void> {
  panelEl.hidden = false;
  await disegna();
}

function chiudi(): void {
  panelEl.hidden = true;
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
let generazione = 0;

async function disegna(): Promise<void> {
  const mia = ++generazione;
  for (const bottone of tabsEl.querySelectorAll<HTMLButtonElement>("button[data-scheda]")) {
    bottone.classList.toggle("active", bottone.dataset.scheda === scheda);
  }
  let nodi: HTMLElement[];
  try {
    if (scheda === "impostazioni") nodi = await disegnaForm();
    else if (scheda === "componenti") nodi = await disegnaComponenti();
    else nodi = await disegnaVault();
  } catch (e) {
    // Un pannello che non riesce a leggere lo dice: il §20.2 avrà il canale
    // vero, e finché non c'è questo è il posto più visibile che ha.
    nodi = [riga("muted", `Non riesco a leggere: ${errorText(e)}`)];
  }
  if (mia !== generazione) return;
  bodyEl.replaceChildren(...nodi);
}

// --- la scheda delle impostazioni -------------------------------------------

async function disegnaForm(): Promise<HTMLElement[]> {
  const entries = await impostazioni();
  if (entries.length === 0) {
    return [riga("muted", "Nessun componente dichiara impostazioni.")];
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

function disegnaRiga(entry: SettingEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";

  const testo = document.createElement("div");
  testo.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = entry.spec.label;
  label.htmlFor = `setting-${entry.spec.key}`;
  testo.append(label);
  if (entry.spec.description) {
    testo.append(riga("muted", entry.spec.description));
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
    azzera.textContent = "Azzera";
    azzera.title = "Dimentica questa scelta: torna a valere il livello sotto";
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
        fuori.textContent = `${corrente} (fuori dalle scelte dichiarate)`;
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

/// Scrive, e ridisegna: la provenienza di una riga cambia insieme al valore, e
/// un form che non si ridisegnasse mostrerebbe «valore predefinito» sotto un
/// valore appena scelto.
async function scrivi(azione: () => Promise<void>): Promise<void> {
  try {
    await azione();
  } catch (e) {
    notify(`Impostazione non cambiata: ${errorText(e)}`, "guasto");
  }
  await disegna();
}

// --- la scheda dei componenti -----------------------------------------------

async function disegnaComponenti(): Promise<HTMLElement[]> {
  const bundles = await api.listBundles();
  return [
    riga(
      "muted",
      "Un componente spento si smonta subito e non viene più montato " +
        "all'apertura del vault: non registra niente, e le sue impostazioni " +
        "non compaiono.",
    ),
    ...bundles.map(disegnaComponente),
  ];
}

function disegnaComponente(bundle: BundleInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  const testo = document.createElement("div");
  testo.className = "setting-text";
  const label = document.createElement("label");
  label.textContent = bundle.name;
  label.htmlFor = `bundle-${bundle.id}`;
  testo.append(label, riga("muted", bundle.id));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `bundle-${bundle.id}`;
  input.checked = bundle.mounted;
  input.addEventListener("change", () => {
    void (async () => {
      try {
        // Ciò che torna sono gli errori **dello spegnimento**, che non sono un
        // motivo per non spegnere: si dicono e basta.
        const problemi = await api.setPluginEnabled(bundle.id, input.checked);
        for (const p of problemi) notify(p, "guasto");
        // Il montaggio è già avvenuto lato host; qui si riallinea **il resto
        // della finestra**, o le view di un componente spento resterebbero
        // appese nella sidebar e i suoi comandi nella palette.
        await ganci.ricaricaProvider();
      } catch (e) {
        notify(`Componente non cambiato: ${errorText(e)}`, "guasto");
      }
      await disegna();
    })();
  });
  el.append(testo, input);
  return el;
}

// --- la scheda dei vault conosciuti -----------------------------------------

async function disegnaVault(): Promise<HTMLElement[]> {
  const vaults = await api.knownVaults();
  if (vaults.length === 0) {
    return [riga("muted", "Nessun vault ancora aperto da questa macchina.")];
  }
  return vaults.map(disegnaVaultRiga);
}

function disegnaVaultRiga(vault: VaultEntry): HTMLElement {
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
  apri.textContent = "Apri";
  apri.addEventListener("click", () => {
    void (async () => {
      try {
        // La strada è **quella di `main.ts`** e non un `openVault` seguito da
        // un reload: ricaricare rimette la shell nello stato iniziale, e lo
        // stato iniziale si ricostruisce da `FUBMD_VAULT` — che quasi sempre
        // non c'è. Il backend avrebbe il vault aperto e la finestra sarebbe
        // vuota, senza nemmeno un modo di dirlo.
        await ganci.apriVault(vault.root);
        chiudi();
      } catch (e) {
        notify(`Vault non aperto: ${errorText(e)}`, "guasto");
      }
    })();
  });

  const preferito = document.createElement("button");
  preferito.className = "link-button";
  preferito.textContent = vault.favorite ? "★" : "☆";
  preferito.title = vault.favorite ? "Togli dai preferiti" : "Appunta fra i preferiti";
  preferito.addEventListener("click", () => {
    void scriviVault(() => api.setVaultFavorite(vault.root, !vault.favorite));
  });

  const dimentica = document.createElement("button");
  dimentica.className = "link-button";
  dimentica.textContent = "Dimentica";
  dimentica.title = "Toglie dall'elenco. Non cancella niente dal disco.";
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
    notify(`Registro dei vault: ${errorText(e)}`, "guasto");
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
  if (typeof value === "boolean") return value ? "acceso" : "spento";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "niente";
  return String(value);
}
