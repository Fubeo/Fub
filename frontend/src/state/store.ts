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
import type { CommandSpec, PaneMode, WorkspaceMeta } from "../host/contract";

// --- i segnali --------------------------------------------------------------
//
// Il payload di ogni segnale è dichiarato come **tupla degli argomenti**: così
// `emit("organization")` non chiede un argomento finto e `emit("documents", d)`
// ne pretende uno del tipo giusto.

export interface Signals {
  /// Un vault è stato aperto (payload: la sua radice). Chi tiene stato legato
  /// al vault — cartelle aperte, spazio attivo, pannelli — riparte da qui.
  vault: [root: string];
  /// La lista dei documenti del vault è cambiata.
  documents: [docs: string[]];
  /// Il documento aperto è cambiato, o si è chiuso (`null`).
  "active-doc": [doc: string | null];
  /// L'organizzazione (icone, appuntate, ordinamenti, spazi, spazio attivo,
  /// cartelle aperte) è cambiata: la sidebar si ridisegna.
  organization: [];
  /// Il kernel ha detto **quali** view sono invecchiate dopo la pubblicazione
  /// del contesto (`ViewSpec.follows`). Il verso è questo, e non una chiamata
  /// diretta, perché chi pubblica il contesto è il pannello del documento e
  /// chi monta le view è `ui/views.ts`: chiamarsi per nome sarebbe un ciclo.
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
      console.error(`FubMD: un ascoltatore di «${signal}» ha lanciato: ${e}`);
    }
  }
}

// --- lo stato ---------------------------------------------------------------

export interface ShellState {
  /// La radice del vault aperto ("" se nessuno).
  vaultRoot: string;
  /// Il documento aperto nel pannello, se c'è.
  currentDoc: string | null;
  /// L'ultima lista di documenti disegnata: serve a ridisegnare la sidebar
  /// senza richiederla al kernel a ogni ritocco dell'organizzazione. Non è una
  /// verità, è un'eco — chi crea o rinomina passa comunque dal kernel.
  knownDocs: string[];
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
  /// sidecar `.fubmd/workspace.json`. Autorevole, non derivato.
  meta: WorkspaceMeta;
  /// Un sidecar illeggibile congela l'organizzazione: si lavora col default ma
  /// non si salva, perché salvare sovrascriverebbe ciò che l'utente ha già.
  metaBroken: boolean;
  /// Lo spazio selezionato nella striscia (null = "home", tutto il vault).
  activeSpace: string | null;
  /// Cartelle aperte nell'albero.
  expanded: Set<string>;
  /// I comandi dichiarati dal kernel, per le scorciatoie: quali esistano lo
  /// dice il registro (`list_commands`), non questa shell.
  commandSpecs: CommandSpec[];
}

export function metaVuota(): WorkspaceMeta {
  return { icons: {}, pinned: [], order: {}, spaces: [] };
}

export const state: ShellState = {
  vaultRoot: "",
  currentDoc: null,
  knownDocs: [],
  dirty: false,
  mode: "live_preview",
  handledExtensions: ["md"],
  versioningOn: false,
  meta: metaVuota(),
  metaBroken: false,
  activeSpace: null,
  expanded: new Set(),
  commandSpecs: [],
};

// --- lo stato di vista, per macchina ----------------------------------------
//
// Modalità, cartelle aperte e spazio selezionato non sono organizzazione del
// vault: sono «come sto guardando questa roba adesso, su questa macchina». Su
// un altro dispositivo sarebbero rumore, e infatti non entrano nel sidecar —
// stanno in `localStorage`. Le chiavi sono raccolte qui perché una chiave di
// persistenza scritta in due punti diverge al primo refuso.

const MODE_KEY = "fubmd.mode";

function expandedKey(): string {
  return `fubmd:expanded:${state.vaultRoot}`;
}

function activeSpaceKey(): string {
  return `fubmd:space:${state.vaultRoot}`;
}

/// La modalità dell'ultima sessione, se ne resta traccia.
export function loadMode(): PaneMode {
  const salvata = localStorage.getItem(MODE_KEY);
  return salvata === "source" || salvata === "reading" || salvata === "live_preview"
    ? salvata
    : "live_preview";
}

export function saveMode(mode: PaneMode): void {
  localStorage.setItem(MODE_KEY, mode);
}

export function loadExpanded(): void {
  try {
    state.expanded = new Set(JSON.parse(localStorage.getItem(expandedKey()) ?? "[]"));
  } catch {
    state.expanded = new Set();
  }
}

export function saveExpanded(): void {
  localStorage.setItem(expandedKey(), JSON.stringify([...state.expanded]));
}

export function loadActiveSpace(): void {
  state.activeSpace = localStorage.getItem(activeSpaceKey());
}

export function saveActiveSpace(): void {
  if (state.activeSpace === null) localStorage.removeItem(activeSpaceKey());
  else localStorage.setItem(activeSpaceKey(), state.activeSpace);
}
