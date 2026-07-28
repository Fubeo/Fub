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
  DocumentMatch,
  IndexQuery,
  JobStatus,
  IndexResult,
  NeighborRef,
  Page,
  Paged,
  QueryExpr,
  TagCount,
  VaultStatus,
} from "./contract";
import { OGNI_DOCUMENTO } from "./contract";

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

/// Che rapporto ha questo vault con il disco (§9.7): FubMD saprebbe che è
/// cambiato da fuori, e cosa non è già riuscito a leggere.
///
/// Passa dal canale dati e non da un comando suo perché la stessa risposta
/// dev'essere visibile a una feature, che di comandi IPC non ne ha nessuno.
export async function statoDelVault(): Promise<VaultStatus> {
  return open(await api.queryIndex({ kind: "vault_status" }), "vault_status");
}
