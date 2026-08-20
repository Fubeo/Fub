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
import type { CommandSpec, Organization } from "../host/contract";
import { api } from "../host/ipc";
import { errorText } from "../host/errors";
import { CoalescingQueue } from "../ui/race";
import { notify } from "../ui/notify";
import { t } from "../i18n/strings";

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
  /// La disposizione dei riquadri è cambiata: qualcuno ha diviso, chiuso,
  /// aperto una linguetta, spostato il fuoco. **Senza payload**, come `documents`:
  /// dice quando, e la parte che serve la legge chi disegna da `state/layout.ts`
  /// — che è la verità, non una copia che passa di qui.
  layout: [];
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
  const list = listeners.get(signal);
  if (list) list.push(listener as Listener);
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
      notify(t("store.listener_failed", { signal, reason: errorText(e) }), "guasto");
    }
  }
}

// --- lo stato ---------------------------------------------------------------

export interface ShellState {
  /// La radice del vault aperto ("" se nessuno).
  vaultRoot: string;
  /// Il documento attivo nel riquadro **col fuoco**, se c'è.
  ///
  /// È uno specchio, non la verità: la verità è `state/layout.ts`, dove ogni
  /// riquadro ha le sue linguetta. Resta qui perché chi lo legge — l'esploratore che
  /// evidenzia la riga, il grafo che centra il nodo — chiede *cosa sta
  /// guardando l'utente*, che è una domanda sola anche con N riquadri; e
  /// tenerla qui evita a cinque punti di disegno di sapere cos'è un riquadro.
  currentDoc: string | null;
  /// Le estensioni che i provider registrati del backend gestiscono: quali
  /// siano lo sanno i `FormatDescriptor`, non la UI — e markdown è il primo
  /// formato, non l'unico. Servono a riconoscere una folder note.
  handledExtensions: string[];
  /// L'organizzazione del vault (icone, appuntate, ordinamenti, spazi): il
  /// sidecar `.fub/workspace.json`. Autorevole, non derivato — e dal §11.3 la
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

export function emptyMeta(): Organization {
  return { icons: {}, pinned: [], order: {}, spaces: [] };
}

export const state: ShellState = {
  vaultRoot: "",
  currentDoc: null,
  handledExtensions: ["md"],
  meta: emptyMeta(),
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
// La **modalità** stava qui, e adesso non più: da quando i riquadri sono N è di
// ciascuno, e vive dentro il layout (`state/layout.ts`) insieme alle linguetta. La
// chiave vecchia si legge ancora una volta, di là, per non far ripartire in Live
// Preview chi stava leggendo — è l'unica traccia che questa migrazione lascia.
//
// Le chiavi sono raccolte qui perché una chiave di persistenza scritto in due
// punti diverge al primo refuso. Quella del layout fa eccezione e sta col
// layout, che è l'unico a scriverla: il criterio è *chi la possiede*, non *dove
// sta la funzione che legge*.

const EXPANDED_KEY = "expanded";
const ACTIVE_SPACE_KEY = "activeSpace";

export async function loadExpanded(): Promise<void> {
  const saved = await readState<string[]>(EXPANDED_KEY);
  state.expanded = new Set(Array.isArray(saved) ? saved : []);
}

export function saveExpanded(): void {
  // Nessuna cartella aperta si **dimentica** invece di scrivere una lista vuota:
  // è ciò che significa, e il file non si porta dietro una riga per ogni vault
  // che qualcuno ha aperto e richiuso.
  writeState(EXPANDED_KEY, state.expanded.size > 0 ? [...state.expanded] : null);
}

export async function loadActiveSpace(): Promise<void> {
  const saved = await readState<string>(ACTIVE_SPACE_KEY);
  state.activeSpace = typeof saved === "string" ? saved : null;
}

export function saveActiveSpace(): void {
  writeState(ACTIVE_SPACE_KEY, state.activeSpace);
}

/// Rileggere: **assente non è un errore**, ed è il caso normale del primo avvio.
/// Nemmeno un errore lo è, qui: senza vault aperto — o con un file di stato che
/// non si è potuto leggere — si riparte dal default, che è ciò che la shell
/// mostrava prima che qualcuno guardasse qualcosa. Perdere lo scroll è meglio di
/// una shell che non parte.
export async function readState<T>(key: string): Promise<T | null> {
  try {
    return await api.viewState<T>(key);
  } catch {
    return null;
  }
}

/// Le scritture di stato passano da una coda che **coalesce per chiave**: due
/// scritture della stessa chiave accavallate sono una scrittura sola, con
/// l'ultimo valore, e due chiavi diverse non si mettono in coda a vicenda. La
/// forma sta in `ui/race.ts`, accanto a `Coda` — non qui, perché chi domani
/// avrà bisogno di «deve arrivare, ma conta solo l'ultimo valore per quella
/// chiave» la eredita dal posto che tutti attraversano.
const stateQueue = new CoalescingQueue();

/// Ricordare, **senza aspettare**: chi apre una cartella nell'albero non deve
/// fermarsi per una scrittura su disco.
///
/// La scrittura passa dalla coda qui sopra: parte appena il turno della sua
/// chiave arriva, e chi l'ha chiesta può sapere quando è finita — ma non si
/// ferma ad aspettarla, e un errore resta un avviso, non un'eccezione.
///
/// L'obiezione che teneva questo punto in console era giusta e riguardava il
/// *testo*, non il canale: nominare la chiave voleva dire un avviso diverso a
/// ogni click, per un file di cache che al prossimo avvio si riscrive da sé. La
/// frase qui non la nomina, e allora quattordici fallimenti di fila diventano
/// una riga con «×14» — che è esattamente ciò per cui `raccogli` esiste (§10.3).
/// Il tono è `info`: non si è perso lavoro dell'utente, si è persa la memoria di
/// come aveva lasciato i pannelli.
export function writeState(key: string, value: unknown): void {
  void stateQueue.enqueueByKey(key, () =>
    api.setViewState(key, value).catch(() => {
      notify(t("state.not_remembered"), "info");
    })
  );
}
