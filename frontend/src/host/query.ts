// Il canale dati visto dalla shell: si costruisce una `IndexQuery`, si legge
// una `IndexResult`.
//
// Sta accanto a `ipc.ts` e non dentro i pannelli perché la risposta è un
// `variant`, e lo `switch` che ne estrae il caso giusto scritto in ogni
// chiamante è il moltiplicatore che il §16.6 conta: tre righe qui, invece di
// tre `match` con tre messaggi d'errore diversi là.
//
// Non è un livello di astrazione sul canale — un pannello che volesse una query
// che qui non c'è la manda con `api.queryIndex` e basta, come farebbe un
// plugin. È solo il posto dove la risposta si apre.
import { api } from "./ipc";
import type {
  Organization,
  DocumentMatch,
  EntryKind,
  FolderScope,
  IndexQuery,
  JobStatus,
  SettingEntry,
  IndexResult,
  LinkTarget,
  NeighborRef,
  Page,
  Paged,
  QueryExpr,
  ResolvedRef,
  TagCount,
  VaultEntry,
  VaultFolder,
  VaultStatus,
} from "./contract";
import { OGNI_DOCUMENTO, questiDocumenti } from "./contract";

/// Apre la risposta, o dice **cosa** è arrivato invece.
///
/// Un errore qui non è un caso da gestire: è il kernel che ha risposto fuori
/// tema, cioè un difetto. Nominarlo serve a chi lo legge in console, non a chi
/// disegna.
type PayloadOf = {
  [K in IndexResult["kind"]]: Extract<IndexResult, { kind: K }>["value"];
};

function open<K extends keyof PayloadOf>(result: IndexResult, kind: K): PayloadOf[K] {
  if (result.kind !== kind) {
    throw new Error(`il canale dati ha risposto ${result.kind}, atteso ${kind}`);
  }
  // Il `kind` combacia, quindi il payload è quello del suo caso: TypeScript non
  // sa restringere un generico su un discriminante, e il cast è l'unico punto
  // in cui glielo si dice.
  return (result as { value: unknown }).value as PayloadOf[K];
}

/// I documenti che combaciano.
export async function documentiCheCombaciano(
  matching: QueryExpr,
  page?: Page,
): Promise<Paged<DocumentMatch>> {
  const query: IndexQuery = {
    kind: "documents",
    matching,
    sort: null,
    select: { kind: "none" },
    page: page ?? null,
  };
  return open(await api.queryIndex(query), "documents");
}

/// Quali di questi documenti **esistono**, in una domanda sola.
///
/// La foglia `docs` la valuta chi ha i metadati in cache, e la restringe a ciò
/// che conosce: la risposta è l'intersezione. Serve a chi tiene dei path
/// scritti da qualche altra parte — le note appuntate nel sidecar, la folder
/// note che una cartella *potrebbe* avere — e prima si faceva cercandoli dentro
/// l'elenco intero del vault, che è il giro che il §14.4 esiste per togliere.
export async function documentiEsistenti(docs: string[]): Promise<Set<string>> {
  if (docs.length === 0) return new Set();
  const page = await documentiCheCombaciano(questiDocumenti(docs));
  return new Set(page.items.map((m) => m.doc));
}

/// I tag del vault con la loro frequenza.
export async function tagDelVault(): Promise<TagCount[]> {
  const query: IndexQuery = { kind: "tags", matching: OGNI_DOCUMENTO, page: null };
  return open(await api.queryIndex(query), "tags").items;
}

/// Gli archi del grafo, in **una** domanda: i vicini a un passo di *ogni*
/// documento, verso uscente. A `depth: 1` il `via` è il documento di partenza,
/// quindi ogni riga è già un arco (via → doc).
///
/// Prima era un comando dell'app che faceva una query per nota e ricomponeva:
/// una superficie privilegiata che un plugin non poteva avere, e sull'IPC mille
/// viaggi per disegnare un grafo.
export async function archiDelVault(): Promise<NeighborRef[]> {
  const query: IndexQuery = {
    kind: "neighbors",
    seeds: OGNI_DOCUMENTO,
    direction: "outbound",
    depth: 1,
    page: null,
  };
  return open(await api.queryIndex(query), "neighbors").items;
}

/// I lavori lunghi **vivi**, dal più vecchio: quelli che stanno girando e
/// quelli che aspettano un thread libero (§10.3).
///
/// È la **riconciliazione** del centro attività, non il suo canale normale: le
/// righe le muovono gli eventi (`job_started`, `job_progress`, `job_done`), e
/// questa domanda serve quando quel filo si è interrotto — all'apertura del
/// pannello, e dopo un `overflow`, che vuol dire esattamente *richiedi*.
export async function lavoriInCorso(): Promise<JobStatus[]> {
  return open(await api.queryIndex({ kind: "jobs" }), "jobs");
}

/// Com'è configurato questo vault (§11.1): schema, valore che vale adesso, e
/// livello da cui viene, in ordine di chiave.
///
/// È la stessa domanda che fa un plugin, e la fa dallo stesso canale: il
/// pannello delle impostazioni non ha un comando privilegiato che una feature
/// non avrebbe.
export async function impostazioni(plugin?: string): Promise<SettingEntry[]> {
  return open(await api.queryIndex({ kind: "settings", plugin: plugin ?? null }), "settings");
}

/// Com'è organizzato questo vault (§11.3): icone, note appuntate, ordinamenti
/// scelti a mano, spazi.
///
/// Dal canale dati e non da un comando suo, come tutto il resto qui dentro:
/// prima era un comando IPC che restituiva il blob intero, cioè una cosa che la
/// shell sapeva chiedere e un provider no.
export async function organizzazione(): Promise<Organization> {
  return open(await api.queryIndex({ kind: "organization" }), "organization");
}

/// Cosa nomina questo riferimento, adesso (§13.1): il documento del vault e —
/// quando il riferimento porta un punto — **dove dentro**; oppure `null`.
///
/// `from` è il documento **dentro cui** il riferimento è scritto, e serve ai
/// `path`, che sono relativi alla cartella di chi li ospita; per un wikilink
/// non cambia niente. `null` non è un errore: un link rotto, un URL esterno e
/// una nota rinominata via da sotto danno tutti e tre `null`, e chi ha chiesto
/// decide cosa proporre.
///
/// `at` è la metà di risposta che prima non aveva dove stare (§21.10): un
/// `[[Nota#Sezione]]` o un `[[Nota#^blocco]]` è sempre stato parsato per
/// intero, ma la risposta sapeva dire solo *quale documento* — quindi chi
/// risolveva scartava il resto e il link apriva la nota in cima, in silenzio.
///
/// Prima era `resolve_link`, un comando IPC scritto apposta — cioè la sola
/// risposta sul vault che questa shell sapeva chiedere e un provider no.
export async function riferimentoRisolto(
  target: LinkTarget,
  from?: string,
): Promise<ResolvedRef | null> {
  return open(
    await api.queryIndex({ kind: "resolve", target, from: from ?? null }),
    "resolved",
  );
}

/// Cosa c'è nel vault (§14.1, §14.2): l'anagrafe, in ordine di path.
///
/// `of_kind` assente = tutte le specie, allegati e sconosciuti compresi — ed è
/// la ragione per cui questa domanda non è `documents` con un filtro: risponde
/// anche su ciò che nessun provider sa parsare, e un PNG nel vault prima di
/// questa voce semplicemente non esisteva.
///
/// La finestra c'è dal primo giorno: è la stessa `Page` di ogni altra risposta
/// paginata, e chiedere tutto vuol dire ometterla — non passare un limite
/// grande.
export async function vociDelVault(
  of_kind?: EntryKind,
  within?: FolderScope,
  page?: Page,
): Promise<Paged<VaultEntry>> {
  const query: IndexQuery = {
    kind: "entries",
    of_kind: of_kind ?? null,
    within: within ?? null,
    page: page ?? null,
  };
  return open(await api.queryIndex(query), "entries");
}

/// Le cartelle (§14.3), in ordine di path.
///
/// `under` assente = ogni cartella del vault, a ogni profondità: è l'elenco da
/// cui si sceglie (uno spazio, una destinazione). Con `{ path, descendants:
/// false }` è **un livello solo**, cioè ciò che serve ad aprire un nodo
/// dell'albero senza chiedere il resto del vault.
///
/// Le cartelle arrivano dal kernel e non si deducono più dai path delle note:
/// una cartella vuota c'è, e una che è rimasta vuota non sparisce.
export async function cartelleDelVault(
  under?: FolderScope,
  page?: Page,
): Promise<Paged<VaultFolder>> {
  const query: IndexQuery = {
    kind: "folders",
    under: under ?? null,
    page: page ?? null,
  };
  return open(await api.queryIndex(query), "folders");
}

/// I figli diretti di una cartella: le sottocartelle e le note, in **una sola
/// coppia di domande** (§14.3, §14.4).
///
/// È la forma che disegna un livello di albero, e le due domande partono
/// insieme perché sono indipendenti: aspettare la prima per fare la seconda
/// raddoppierebbe l'attesa di ogni cartella che si apre.
export async function contenutoDiCartella(
  path: string,
): Promise<{ folders: VaultFolder[]; notes: string[] }> {
  const scope: FolderScope = { path, descendants: false };
  const [folders, notes] = await Promise.all([
    cartelleDelVault(scope),
    vociDelVault("document", scope),
  ]);
  return { folders: folders.items, notes: notes.items.map((e) => e.id) };
}

/// Che rapporto ha questo vault con il disco (§9.7): FubMD saprebbe che è
/// cambiato da fuori, e cosa non è già riuscito a leggere.
///
/// Passa dal canale dati e non da un comando suo perché la stessa risposta
/// dev'essere visibile a una feature, che di comandi IPC non ne ha nessuno.
export async function statoDelVault(): Promise<VaultStatus> {
  return open(await api.queryIndex({ kind: "vault_status" }), "vault_status");
}
