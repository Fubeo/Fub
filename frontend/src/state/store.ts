// Lo stato condiviso della shell, e il bus con cui i moduli di dominio si
// avvisano — le due metà del «piccolo store condiviso» che il §1.2 chiede.
//
// Prima erano diciotto variabili globali mutabili in `main.ts`, e chi doveva
// reagire a un cambiamento veniva chiamato per nome dal punto che lo produceva:
// è la ragione per cui `handleKernelEvent` conosceva privatamente ogni
// pannello. Qui il verso è rovesciato — chi cambia qualcosa **lo dice**, chi ha
// interesse **si iscrive** — e il guadagno vero non è l'eleganza: è che
// `panels/explorer.ts` e `panels/document.ts` possono entrambi dipendere da
// questo modulo senza dipendere l'uno dall'altro. Un ciclo di import fra due
// moduli di dominio, in un bundle ESM, è un `undefined` all'avvio che non dice
// da dove viene.
//
// Cosa NON sta qui: lo stato che appartiene a un pannello solo (i risultati di
// ricerca, le voci del cestino, l'anteprima di una versione). Uno store che
// raccoglie tutto torna a essere l'oggetto-dio, con un file diverso.
import type { CommandSpec, Organization, PaneMode } from "../host/contract";
import { api } from "../host/ipc";
import { errorText } from "../host/errors";

// --- i segnali --------------------------------------------------------------
//
// Il payload di ogni segnale è dichiarato come **tupla degli argomenti**: così
// `emit("organization")` non chiede un argomento finto e `emit("documents", d)`
// ne pretende uno del tipo giusto.

export interface Signals {
  /// Un vault è stato aperto (payload: la sua radice). Chi tiene stato legato
  /// al vault — cartelle aperte, spazio attivo, pannelli — riparte da qui.
  vault: [root: string];
  /// La lista dei documenti del vault è cambiata. **Senza payload** (§14.4):
  /// portava l'intero elenco, e chi lo riceveva ne disegnava venti righe. Dice
  /// quando, non cosa: la parte che serve la chiede chi disegna.
  documents: [];
  /// Il documento aperto è cambiato, o si è chiuso (`null`).
  "active-doc": [doc: string | null];
  /// L'organizzazione (icone, appuntate, ordinamenti, spazi, spazio attivo,
  /// cartelle aperte) è cambiata: la sidebar si ridisegna.
  organization: [];
  /// Il kernel ha detto **quali** view sono invecchiate dopo la pubblicazione
  /// del contesto (`ViewSpec.follows`). Il verso è questo, e non una chiamata
  /// diretta, perché chi pubblica il contesto è il pannello del documento e
  /// chi le ridisegna è `ui/panel-host.ts`: chiamarsi per nome sarebbe un ciclo.
  "stale-views": [ids: string[]];
}

type Listener = (...args: never[]) => void;

const listeners = new Map<keyof Signals, Listener[]>();

/// Iscrive un ascoltatore a un segnale. Non si disiscrive: i moduli della shell
/// vivono quanto la finestra, e un `off()` che nessuno chiama è solo una firma
/// in più da spiegare. Quando arriveranno i pannelli smontabili (§9.4) sarà
/// questa la riga da cambiare, in un posto solo.
export function on<K extends keyof Signals>(
  signal: K,
  listener: (...args: Signals[K]) => void,
): void {
  const lista = listeners.get(signal);
  if (lista) lista.push(listener as Listener);
  else listeners.set(signal, [listener as Listener]);
}

/// Annuncia un segnale a chi si è iscritto.
///
/// Gli ascoltatori sono chiamati in ordine di iscrizione e **uno sbaglio non
/// ferma gli altri**: un pannello che lancia mentre si ridisegna non deve
/// impedire agli altri di aggiornarsi — sarebbe un difetto che si manifesta
/// come "metà finestra ferma", cioè nel modo più difficile da ricondurre alla
/// sua causa (§20.3: gli esiti non si buttano via in silenzio).
export function emit<K extends keyof Signals>(signal: K, ...args: Signals[K]): void {
  for (const listener of listeners.get(signal) ?? []) {
    try {
      (listener as (...a: Signals[K]) => void)(...args);
    } catch (e) {
      console.error(`FubMD: un ascoltatore di «${signal}» ha lanciato: ${errorText(e)}`);
    }
  }
}

// --- lo stato ---------------------------------------------------------------

export interface ShellState {
  /// La radice del vault aperto ("" se nessuno).
  vaultRoot: string;
  /// Il documento aperto nel pannello, se c'è.
  currentDoc: string | null;
  /// Il buffer ha modifiche non ancora scritte su disco? Finché è sporco, il
  /// buffer è la verità del documento aperto (vedi
  /// docs/architecture/data-model.md, "Fonte di verità"): non va MAI
  /// sovrascritto da un reload.
  dirty: boolean;
  /// La modalità del pannello (FEATURES 4.1).
  mode: PaneMode;
  /// Le estensioni che i provider registrati del backend gestiscono: quali
  /// siano lo sanno i `FormatDescriptor`, non la UI — e markdown è il primo
  /// formato, non l'unico. Servono a riconoscere una folder note.
  handledExtensions: string[];
  /// Il versioning è acceso in questa sessione? Spento significa assente (D7):
  /// il pannello della cronologia non esiste, e non si interroga.
  versioningOn: boolean;
  /// L'organizzazione del vault (icone, appuntate, ordinamenti, spazi): il
  /// sidecar `.fubmd/workspace.json`. Autorevole, non derivato — e dal §11.3 la
  /// possiede il **kernel**, quindi questo è uno specchio e non la verità.
  ///
  /// Non c'è più un `metaBroken`: il congelamento di un sidecar illeggibile lo
  /// fa il kernel, che rifiuta le scritture una per una invece di seppellire ciò
  /// che non è riuscito a leggere. Un secondo posto in cui ricordarsi di non
  /// salvare era un posto in cui dimenticarsene.
  meta: Organization;
  /// Lo spazio selezionato nella striscia (null = "home", tutto il vault).
  activeSpace: string | null;
  /// Cartelle aperte nell'albero.
  expanded: Set<string>;
  /// I comandi dichiarati dal kernel, per le scorciatoie: quali esistano lo
  /// dice il registro (`list_commands`), non questa shell.
  commandSpecs: CommandSpec[];
}

export function metaVuota(): Organization {
  return { icons: {}, pinned: [], order: {}, spaces: [] };
}

export const state: ShellState = {
  vaultRoot: "",
  currentDoc: null,
  dirty: false,
  mode: "live_preview",
  handledExtensions: ["md"],
  versioningOn: false,
  meta: metaVuota(),
  activeSpace: null,
  expanded: new Set(),
  commandSpecs: [],
};

// --- lo stato di vista, per macchina (§11.2) --------------------------------
//
// Modalità, cartelle aperte e spazio selezionato non sono organizzazione del
// vault: sono «come sto guardando questa roba adesso, su questa macchina». Su un
// altro dispositivo sarebbero rumore, e infatti non entrano nel sidecar.
//
// Stavano in `localStorage`, che era il posto giusto per la ragione giusta e
// sbagliato per due che si vedono usandolo: moriva col profilo della webview, e
// non lo conosceva nessuno fuori di lì — un backend che voglia sapere dove si
// era rimasti (o potarlo quando si dimentica un vault) non poteva. Ora passano
// dalla stessa porta di tutto il resto, e il file è del kernel.
//
// **Il vault non è più nella chiave.** Non serve comporlo: lo store lo mette
// come prima chiave da sé, ed è anche più corretto — `state.vaultRoot` è la
// stringa che la shell ha in mano, il root canonico lo conosce il backend.
//
// Cosa cambia per chi guarda: la **modalità** era globale (una chiave sola per
// tutte le cartelle) e ora è per vault. È un cambiamento voluto: un vault di
// appunti che si legge e uno di note che si scrive non hanno ragione di
// condividere la modalità, e chi ne teneva uno solo non vede differenza.
//
// Le chiavi sono raccolte qui perché una chiave di persistenza scritta in due
// punti diverge al primo refuso.

const MODE_KEY = "mode";
const EXPANDED_KEY = "expanded";
const ACTIVE_SPACE_KEY = "activeSpace";

/// La modalità con cui si guardava questo vault, se ne resta traccia.
///
/// Un valore che non è una delle tre modalità vale come nessun valore: il file
/// si apre con un editor di testo, e una parola scritta a mano dentro `mode` non
/// vale una shell che parte in uno stato che non esiste.
export async function loadMode(): Promise<PaneMode> {
  const salvata = await leggi<string>(MODE_KEY);
  return salvata === "source" || salvata === "reading" || salvata === "live_preview"
    ? salvata
    : "live_preview";
}

export function saveMode(mode: PaneMode): void {
  scrivi(MODE_KEY, mode);
}

export async function loadExpanded(): Promise<void> {
  const salvate = await leggi<string[]>(EXPANDED_KEY);
  state.expanded = new Set(Array.isArray(salvate) ? salvate : []);
}

export function saveExpanded(): void {
  // Nessuna cartella aperta si **dimentica** invece di scrivere una lista vuota:
  // è ciò che significa, e il file non si porta dietro una riga per ogni vault
  // che qualcuno ha aperto e richiuso.
  scrivi(EXPANDED_KEY, state.expanded.size > 0 ? [...state.expanded] : null);
}

export async function loadActiveSpace(): Promise<void> {
  const salvato = await leggi<string>(ACTIVE_SPACE_KEY);
  state.activeSpace = typeof salvato === "string" ? salvato : null;
}

export function saveActiveSpace(): void {
  scrivi(ACTIVE_SPACE_KEY, state.activeSpace);
}

/// Rileggere: **assente non è un errore**, ed è il caso normale del primo avvio.
/// Nemmeno un errore lo è, qui: senza vault aperto — o con un file di stato che
/// non si è potuto leggere — si riparte dal default, che è ciò che la shell
/// mostrava prima che qualcuno guardasse qualcosa. Perdere lo scroll è meglio di
/// una shell che non parte.
async function leggi<T>(key: string): Promise<T | null> {
  try {
    return await api.viewState<T>(key);
  } catch {
    return null;
  }
}

/// Ricordare, **senza aspettare**: chi apre una cartella nell'albero non deve
/// fermarsi per una scrittura su disco. È anche la ragione per cui il fallimento
/// qui si scrive in console e non si mostra: l'unico modo di raccontarlo sarebbe
/// un avviso a ogni click, per un file di cache che al prossimo avvio si
/// riscrive da sé.
function scrivi(key: string, value: unknown): void {
  void api.setViewState(key, value).catch((e) => {
    console.warn(`FubMD: non ho potuto ricordare \`${key}\``, e);
  });
}
