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
  DraftInfo,
  Organization,
  DocumentMatch,
  EntryKind,
  Excerpts,
  FolderScope,
  IndexQuery,
  JobStatus,
  SettingEntry,
  IndexResult,
  LinkTarget,
  Page,
  Paged,
  QueryExpr,
  ResolvedRef,
  TagCount,
  VaultEntry,
  VaultFolder,
  VaultStatus,
} from "./contract";
import { OGNI_DOCUMENTO, nomeCercato, questiDocumenti } from "./contract";

/// Apre la risposta, o dice **cosa** è arrivato invece.
///
/// Un errore qui non è un caso da gestire: è il kernel che ha risposto fuori
/// tema, cioè un difetto. Nominarlo serve a chi lo legge in console, non a chi
/// disegna.
type PayloadOf = {
  [K in IndexResult["kind"]]: Extract<IndexResult, { kind: K }>["value"];
};

/// **Chiedere tutto è una risposta, non un'omissione** (§2.9).
///
/// Fino a ieri la finestra di queste domande era un parametro *opzionale*:
/// ometterlo voleva dire «tutto il vault», e ometterlo è la cosa che si fa
/// senza deciderlo. Il risultato misurato era che il pannello dei comandi
/// chiedeva l'anagrafe intera per riempire un `<datalist>`, il menu degli spazi
/// ogni cartella a ogni profondità, e un livello d'albero tutte le note della
/// cartella — tre superfici che nessuno aveva deciso fossero illimitate.
///
/// Adesso la finestra è il **primo** argomento e non ha default: la prima
/// domanda da farsi non è cosa si chiede ma quanto. Chi vuole davvero tutto lo
/// scrive — è la stessa forma della 0092, dove scrivere ciechi ha smesso di
/// succedere omettendo ed è diventato un caso da nominare.
///
/// # Perché un simbolo e non la stringa che era
///
/// Le domande aperte si contano da fuori (`conteggi.mjs`, `finestre-aperte`:
/// oggi due [conta: finestre-aperte]), e un conto che legge il sorgente vale
/// quanto vale il modo di aggirarlo. Con una costante di stringa il tipo era
/// `"senza-finestra"`, e **scrivere quel letterale al posto della costante
/// compilava**: una domanda aperta in più senza una riga in più per il conto,
/// cioè la trappola che questo repo ha già incontrato dodici volte in un giro
/// solo. Un `unique symbol` non si scrive: si nomina. Il conto e il
/// compilatore stanno d'accordo per costruzione, e non per attenzione.
export const SENZA_FINESTRA = Symbol("senza-finestra");

/// Quanto si vuole di una risposta: una finestra, o tutto avendolo detto.
export type Finestra = Page | typeof SENZA_FINESTRA;

function finestraDi(f: Finestra): Page | null {
  return f === SENZA_FINESTRA ? null : f;
}

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
///
/// `excerpts` omesso = `attach`, cioè una risposta completa: è il default del
/// contratto e la cosa giusta per chi mostra dei risultati. Chi mostra dei
/// **nomi** passa `omit` e non fa generare un estratto per riga — sul banco
/// della seduta (`una_ricerca.rs`, fase 5) è la differenza fra 3 e 5 ms su un
/// vault da duemila note, e per una superficie che parte a ogni battuta è la
/// metà del budget spesa per del testo che nessuno disegna.
export async function documentiCheCombaciano(
  matching: QueryExpr,
  finestra: Finestra,
  excerpts?: Excerpts,
): Promise<Paged<DocumentMatch>> {
  const query: IndexQuery = {
    kind: "documents",
    matching,
    sort: null,
    select: { kind: "none" },
    page: finestraDi(finestra),
    excerpts,
  };
  return open(await api.queryIndex(query), "documents");
}

/// Quante note propone chi propone dei nomi.
///
/// Venti, e il numero è la finestra di ciò che si **guarda**, non di ciò che si
/// cerca: nessuno legge la ventunesima riga di un elenco che si ridisegna
/// mentre si scrive, e la finestra è ciò che tiene il giro per battuta lontano
/// dal costo per risultato misurato dal banco.
const QUANTI_NOMI = 20;

/// **Le note il cui nome combacia**, dalla più pertinente: il giro per battuta
/// del quick switcher e dell'autocompletamento dei wikilink (§21.5).
///
/// È una funzione sola per le due superfici perché è **una** domanda: se
/// domani il ranking dei nomi cambia — la tolleranza ai refusi della §21.1, i
/// pesi regolabili della §21.6 — cambia qui, e le due superfici lo scoprono
/// insieme invece che una alla volta (0082, 0083).
///
/// L'ordine che torna è quello del kernel, ed è ciò che chi disegna deve
/// **rispettare**: un secondo ordinamento nella shell — il fuzzy di CodeMirror,
/// un `sort` per nome — rimescolerebbe una rilevanza calcolata dove ci sono i
/// dati per calcolarla, e le due ricerche tornerebbero due.
export async function noteDalNome(testo: string, quante = QUANTI_NOMI): Promise<string[]> {
  const scritto = testo.trim();
  // La query vuota non si manda: il provider risponderebbe «nessun predicato
  // di testo», cioè tutto il vault, e sarebbe l'elenco intero rientrato dalla
  // finestra. Chi ha bisogno di mostrare qualcosa a mani vuote lo decide da sé.
  if (!scritto) return [];
  const page = await documentiCheCombaciano(
    nomeCercato(scritto),
    { offset: 0, limit: quante },
    "omit",
  );
  return page.items.map((m) => m.doc);
}

/// Quali di questi documenti **esistono**, in una domanda sola.
///
/// La foglia `docs` la valuta chi ha i metadati in cache, e la restringe a ciò
/// che conosce: la risposta è l'intersezione. Serve a chi tiene dei path
/// scritti da qualche altra parte — le note appuntate nel sidecar, la folder
/// note che una cartella *potrebbe* avere — e prima si faceva cercandoli dentro
/// l'elenco intero del vault, che è il giro che il §14.4 esiste per togliere.
///
/// `SENZA_FINESTRA` qui non è una rinuncia: la risposta è **già limitata
/// dall'ingresso** — non può contenere più di `docs.length` righe — e una
/// finestra su una lista che il chiamante ha in mano taglierebbe la sua
/// domanda, non la risposta del vault.
export async function documentiEsistenti(docs: string[]): Promise<Set<string>> {
  if (docs.length === 0) return new Set();
  const page = await documentiCheCombaciano(questiDocumenti(docs), SENZA_FINESTRA);
  return new Set(page.items.map((m) => m.doc));
}

/// I tag del vault con la loro frequenza.
export async function tagDelVault(finestra: Finestra): Promise<TagCount[]> {
  const query: IndexQuery = {
    kind: "tags",
    matching: OGNI_DOCUMENTO,
    page: finestraDi(finestra),
  };
  return open(await api.queryIndex(query), "tags").items;
}

// `archiDelVault` stava qui: gli archi del grafo in una domanda sola, senza
// finestra. **Non lo chiamava nessuno** — il grafo è un `ViewProvider` dalla
// 0079 (`fub-features/src/graph.rs`) e li chiede da dentro il kernel, dove non
// attraversano il ponte. Una funzione che chiede l'intero vault e che nessuno
// esercita non è codice inerte: è un esempio, e il prossimo pannello lo avrebbe
// copiato perché era il più comodo da copiare. Chi ne avrà bisogno la riscrive
// con la sua finestra, ed è una riga.

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

/// **Cosa è rimasto non salvato** (§15.2): le bozze che il buffer di crash ha
/// lasciato sul disco.
///
/// Dal canale dati come tutto il resto qui dentro, e non da una porta sua:
/// leggere non è cambiare. Scriverne una invece ha una porta (`saveDraft`),
/// perché quella è una capacità che non esiste e non deve esistere — il testo
/// non salvato è il dato più privato di un vault.
export async function bozzeNonSalvate(): Promise<DraftInfo[]> {
  return open(await api.queryIndex({ kind: "drafts" }), "drafts").items;
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
/// La finestra c'è dal primo giorno ed è la stessa `Page` di ogni altra
/// risposta paginata. Quello che è cambiato col §2.9 è che **non si omette**:
/// chiedere tutto è `SENZA_FINESTRA`, e passare un limite grande resta la cosa
/// sbagliata (un tetto travestito da finestra non dice a nessuno cosa ha
/// lasciato fuori).
export async function vociDelVault(
  finestra: Finestra,
  of_kind?: EntryKind,
  within?: FolderScope,
): Promise<Paged<VaultEntry>> {
  const query: IndexQuery = {
    kind: "entries",
    of_kind: of_kind ?? null,
    within: within ?? null,
    page: finestraDi(finestra),
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
  finestra: Finestra,
  under?: FolderScope,
): Promise<Paged<VaultFolder>> {
  const query: IndexQuery = {
    kind: "folders",
    under: under ?? null,
    page: finestraDi(finestra),
  };
  return open(await api.queryIndex(query), "folders");
}

/// I figli diretti di una cartella: le sottocartelle e le note, in **una sola
/// coppia di domande** (§14.3, §14.4).
///
/// È la forma che disegna un livello di albero, e le due domande partono
/// insieme perché sono indipendenti: aspettare la prima per fare la seconda
/// raddoppierebbe l'attesa di ogni cartella che si apre.
///
/// **La finestra vale per ciascuna delle due**, e ciò che resta fuori si conta:
/// `altre` non è un dettaglio di disegno, è ciò che permette a chi disegna di
/// dirlo. Un livello troncato in silenzio è una cartella che sembra avere
/// quindici note quando ne ha tremila — cioè il difetto che questa finestra
/// esiste per non introdurre.
export interface ContenutoDiCartella {
  folders: VaultFolder[];
  notes: string[];
  altreCartelle: number;
  altreNote: number;
}

export async function contenutoDiCartella(
  path: string,
  finestra: Finestra,
): Promise<ContenutoDiCartella> {
  const scope: FolderScope = { path, descendants: false };
  const [folders, notes] = await Promise.all([
    cartelleDelVault(finestra, scope),
    vociDelVault(finestra, "document", scope),
  ]);
  return {
    folders: folders.items,
    notes: notes.items.map((e) => e.id),
    altreCartelle: Math.max(0, folders.total - folders.offset - folders.items.length),
    altreNote: Math.max(0, notes.total - notes.offset - notes.items.length),
  };
}

/// Che rapporto ha questo vault con il disco (§9.7): Fub saprebbe che è
/// cambiato da fuori, e cosa non è già riuscito a leggere.
///
/// Passa dal canale dati e non da un comando suo perché la stessa risposta
/// dev'essere visibile a una feature, che di comandi IPC non ne ha nessuno.
export async function statoDelVault(): Promise<VaultStatus> {
  return open(await api.queryIndex({ kind: "vault_status" }), "vault_status");
}
