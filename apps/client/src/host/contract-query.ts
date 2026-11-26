// I tipi del confine per il canale dati: interrogazioni dell'indice e risultati
// (rispecchiati a mano dal Rust; `contract.ts` li ri-esporta).
import type {
  EntryKind,
  Excerpts,
  LinkDirection,
  TaskStatus,
  TextField,
  TextMode,
  TextScope,
  TextTolerance,
} from "./enums.generated";
import type { EmbedContent, RenderedDocument, Span } from "./contract-drawing";
import type { BacklinkRef } from "./contract";
import type {
  JobStatus,
  Organization,
  SettingEntry,
  TagCount,
  VaultStatus,
} from "./contract-settings";

// ---------------------------------------------------------------------------
// Il canale dati (§5.3, §5.4): la query è un albero, non una stringa
// ---------------------------------------------------------------------------
//
// La shell non ha più `search`, `list_tags` e `graph_data`: ha `query_index`,
// come un plugin. Questi tipi rispecchiano `fub_abi::query` e la parte index
// di `fub_abi::traits`, e il presidio è la fixture generata da Rust
// (`mirror.test.ts`): una variante aggiunta là non può restare non gestita qui.
//
// La stringa che l'utente digita non è più una sintassi: è il campo `text` di
// una foglia. Quello che prima era «Query incompleta» — l'errore del parser di
// una dipendenza mostrato all'utente — non esiste più, perché fra la casella e
// i risultati non c'è più nessun parser di terzi.

// In che verso si cammina il grafo dei legame.
export type { LinkDirection } from "./enums.generated";

// Il bersaglio NON RISOLTO di un legame (rispecchia fub_abi::model::LinkTarget).
// Tag ADIACENTE (`kind` + `value`): due varianti su tre portano uno scalare, e
// col tag interno non attraverserebbero il JSON.
//
// Le tre specie sono tre regole di risoluzione diverse, e chi chiede dice quale
// vuole: non c'è un'euristica che le indovini dalla stringa, perché `a/b.md` è
// un wikilink per path *e* un legame markdown relativo, e le due non risolvono
// allo stesso posto.
export type LinkTarget =
  | { kind: "wiki"; value: { page: string; heading?: string | null; block?: string | null } }
  | { kind: "url"; value: string }
  | { kind: "path"; value: string };

// Come si intende la stringa di una `TextQuery`.
export type { TextMode } from "./enums.generated";

// Dove cercare il testo. Vuoto = i campi che il provider indicizza.
// `heading` pesa a parte: distingue una nota che PARLA di una cosa da una che
// ci ha dedicato una sezione.
export type { TaskStatus, TextField } from "./enums.generated";

// Quanto si vuole essere indovinati: un'INTENZIONE, mai una distanza di edit.
// Chi non sa onorare `typos` risponde come per `exact` — restringe, non allarga.
export type { TextTolerance } from "./enums.generated";

export interface TextQuery {
  text: string;
  mode: TextMode;
  fields: TextField[];
  tolerance: TextTolerance;
  case_sensitive: boolean;
  // L'ultimo termine è ancora in corso di scrittura. È una proprietà
  // dell'INVOCAZIONE e non della query: chi **salva** una query — una
  // collezione, una vista, un template — la normalizza a `false` prima di
  // scriverla, perché l'utente aveva finito di scrivere e nessuno era lì a
  // vederlo.
  partial_last_term: boolean;
}

// Una prova su una proprietà del frontmatter. `test` resta opaco per la shell
// finché non ci sarà un query builder (9.2): la costruisce chi la conosce.
export interface PropertyFilter {
  key: string;
  test: unknown;
}

// Le foglie del linguaggio (rispecchia fub_abi::query::QueryPredicate).
export type QueryPredicate =
  | ({ kind: "text" } & TextQuery)
  | { kind: "property"; filter: PropertyFilter }
  | { kind: "tag"; name: string; descendants: boolean }
  | { kind: "folder"; path: string; descendants: boolean }
  | { kind: "linked"; doc: string; direction: LinkDirection }
  | { kind: "docs"; docs: string[] }
  | { kind: "custom"; ns: string; predicate: unknown }
  | { kind: "regex"; pattern: string; fields: TextField[] }
  | { kind: "task"; status: TaskStatus }
  | { kind: "path"; glob: string }
  | { kind: "file"; extension: string }
  | { kind: "scoped"; scope: TextScope; text: TextQuery }
  | { kind: "task_due"; min: DueBound | null; max: DueBound | null };

// Un estremo della scadenza di una task (rispecchia fub_abi::query::DueBound):
// una data `AAAA-MM-GG` e se è compresa.
export interface DueBound {
  date: string;
  inclusive: boolean;
}

// L'unità del corpo dentro cui uno `scoped` vuole tutti i suoi termini.
export type { TextScope } from "./enums.generated";

export interface QueryLiteral {
  negated: boolean;
  predicate: QueryPredicate;
}

// I letterali sono in AND; vuota = ogni documento.
export interface QueryClause {
  all: QueryLiteral[];
}

// Le clausole sono in OR; vuoto = ogni documento.
export interface QueryExpr {
  any: QueryClause[];
}

// Ogni documento del vault: la query da cui parte chi non ha filtri.
export const EVERY_DOCUMENT: QueryExpr = { any: [] };

// Il testo che l'utente ha digitato, ovunque il provider guardi.
//
// `whileTyping` accende `partial_last_term`: l'ultimo termine è incompleto,
// e `arch` deve trovare *architettura* prima che la parola sia finita. Lo dice
// la **query**, non la casella appendendo un `*` da sé: se lo facesse la
// shell, la ricerca dell'utente e quella di CLI, API locale, automazioni e
// centro di comando LLM parlerebbero due lingue diverse, e la differenza non
// sarebbe scritto da nessuna parte.
export function textQuery(text: string, whileTyping = false): QueryExpr {
  return {
    any: [
      {
        all: [
          {
            negated: false,
            predicate: {
              kind: "text",
              text,
              mode: "terms",
              fields: [],
              tolerance: "exact",
              case_sensitive: false,
              partial_last_term: whileTyping,
            },
          },
        ],
      },
    ],
  };
}

// Il testo cercato **dentro** un pugno di documenti: una clausola sola con due
// letterali in AND.
//
// È la ricerca nella nota aperta (§21.4), ed è la prova che quella voce non
// chiedeva niente di nuovo al linguaggio: `Docs { docs: [la nota] }` e un `Text`
// nella stessa clausola sono già dicibili dalla 0019. Sta qui accanto alle altre
// due, e non dentro il pannello che la usa, perché la regola della §21.5 è che
// **una** porta serve tutte le superfici che accettano del testo e propongono
// delle note: se ogni superficie si compone la propria query, il giorno in cui
// il ranking cambia ne cambiamo quattro (0082).
//
// La composizione non è un `and` generico apposta: due `QueryExpr` in AND
// vorrebbero il prodotto delle clausole, e un combinatore che lo fa in silenzio
// è il posto dove nasce la query che non fa ciò che sembra. Qui i letterali
// sono due e la clausola è una, scritto.
export function textInDocument(
  docs: string[],
  text: string,
  whileTyping = false,
): QueryExpr {
  return {
    any: [
      {
        all: [
          { negated: false, predicate: { kind: "docs", docs } },
          {
            negated: false,
            predicate: {
              kind: "text",
              text,
              mode: "terms",
              fields: [],
              tolerance: "exact",
              case_sensitive: false,
              partial_last_term: whileTyping,
            },
          },
        ],
      },
    ],
  };
}

// Il testo cercato **nel nome delle note**, e nient'altro.
//
// È la terza configurazione della porta unica (0082): il quick switcher e
// l'autocompletamento dei wikilink non cercano dentro le note — propongono
// **nomi**, ed è ciò che `TextField::Name` esiste per dire. La differenza con
// `textQuery` non è di ranking ma di dominio: cercare `rust` ovunque trova le
// trecento note che ne parlano, e chi ha premuto la scorciatoia per aprire la
// nota *Rust* le voleva tutte e trecento davanti a sé come non le vorrebbe mai.
//
// `whileTyping` qui è il caso NORMALE e non l'eccezione: queste due
// superfici partono a ogni battuta, e chi ha scritto `ar` sta cercando
// *architettura* e non una nota che si chiami «ar». È il prefisso della §21.2,
// e la ragione per cui non lo mette la casella appendendo un `*` è la stessa di
// `textQuery`: la dice la query, o due chiamanti diversi cercano in due
// lingue diverse.
export function nameQuery(text: string, whileTyping = true): QueryExpr {
  return {
    any: [
      {
        all: [
          {
            negated: false,
            predicate: {
              kind: "text",
              text,
              mode: "terms",
              fields: ["name"],
              tolerance: "exact",
              case_sensitive: false,
              partial_last_term: whileTyping,
            },
          },
        ],
      },
    ],
  };
}

// Questi documenti, per nome: la foglia che chiede «quali di questi esistono?».
// Chi la valuta la restringe a ciò che l'indice conosce, quindi la risposta è
// l'intersezione — ed è il modo di verificare un pugno di path in UNA domanda
// invece di chiedere l'elenco del vault per cercarli dentro.
export function theseDocuments(docs: string[]): QueryExpr {
  return { any: [{ all: [{ negated: false, predicate: { kind: "docs", docs } }] }] };
}

// Quali proprietà del frontmatter portarsi dietro in una risposta.
export type PropertySelect = { kind: "none" } | { kind: "all" } | { kind: "keys"; keys: string[] };

export interface Page {
  offset: number;
  limit: number;
}

// Una risposta a finestra: `total` è il conteggio PRIMA della finestra.
export interface Paged<T> {
  items: T[];
  offset: number;
  total: number;
}

// Un documento che ha combaciato (rispecchia fub_abi::traits::DocumentMatch).
// `snippet` è testo semplice, MAI markup: si inserisce come testo. Le porzioni
// da evidenziare sono `highlights`, intervalli in byte dentro `snippet`.
// I campi opzionali sono **omessi** quando non ci sono: una selezione senza
// pertinenza non ha né rilevanza né estratto.
export interface DocumentMatch {
  doc: string;
  score?: number;
  snippet?: string;
  highlights?: Span[];
  properties?: { key: string; value: unknown }[];
  // DOVE, nel sorgente, sta ciò che ha combaciato — in ordine di posizione.
  // Non è un doppione di `highlights`: quelli servono a **disegnare** una riga
  // (byte dentro `snippet`), queste a **tornare** al testo (byte del sorgente,
  // la stessa valuta di `reveal`). Assente = nessuno le ha calcolate, che è
  // diverso da «nessuna occorrenza».
  occurrences?: DocPosition[];
}

// UN PUNTO DENTRO UN DOCUMENTO (rispecchia fub_abi::traits::DocPosition).
// `span` è in byte del SORGENTE; `anchor` è l'ancora del blocco che lo ospita
// quando ce n'è una; `revision` dice DI QUANDO — uno span invecchia appena il
// documento cambia sotto, e senza sapere di quale sorgente parla si porterebbe
// il cursore altrove senza accorgersene.
export interface DocPosition {
  span: Span;
  anchor?: string;
  revision: string;
}

// Cosa nomina un riferimento (rispecchia fub_abi::traits::ResolvedRef):
// QUALE documento e, quando il riferimento porta un punto e quel punto esiste
// ancora, DOVE DENTRO.
export interface ResolvedRef {
  doc: string;
  at?: DocPosition;
}

// Un vicino nel grafo: `via` è l'anello precedente, ed è ciò che rende la
// risposta un albero invece che un sacchetto di nodi. A `depth: 1` l'arco è
// (via → doc) per gli uscenti: sono esattamente gli archi del grafo.
export interface NeighborRef {
  doc: string;
  via: string;
  depth: number;
}

// Un problema trovato da un controllo di salute del vault.
export interface HealthIssue {
  doc: string;
  check: string;
  detail: string | null;
  span: Span | null;
}

// UNA BOZZA (§15.2): ciò che l'utente stava scrivendo e non ha salvato.
//
// Porta il testo con sé e non un puntatore da risolvere con una seconda
// domanda: la sola ragione per cui questo tipo esiste è che quel testo non vada
// perso, e un elenco che dice «ci sono tre bozze» senza poterle mostrare
// avrebbe rimandato l'unica cosa che conta a una chiamata che può fallire.
export interface DraftInfo {
  doc: string;
  /// Millisecondi UNIX dell'ultima scrittura della bozza.
  at: number;
  /// La revisione del file su cui il buffer stava lavorando, QUANDO chi ha
  /// scritto la bozza la sapeva. `null` vuol dire «non lo so», non «nota
  /// nuova»: quello lo dice `exists`.
  base: string | null;
  /// Il documento c'è ancora? `false` è una bozza ORFANA: l'unica copia rimasta
  /// di ciò che era stato scritto, e per questo non si butta da sola.
  exists: boolean;
  /// La revisione del file ADESSO, per quel che il vault ne sa. È un FATTO, non
  /// un giudizio: che diverga da `base` vuol dire che il file è cambiato sotto,
  /// e cosa farne lo decide chi lo mostra — cioè si chiede a una persona.
  current: string | null;
  text: string;
}

export interface PropertyCount {
  value: unknown;
  count: number;
}

// Un heading dell'outline di un documento.
// `explicit_anchor` è l'ancora `^id` scritto dall'utente in coda al titolo,
// com'è scritto (`null` quando lo slug è generato dal testo).
export interface Heading {
  level: number;
  text: string;
  slug: string;
  span: Span;
  explicit_anchor: string | null;
}

// Se una risposta porta gli estratti (§21.9). Sta fra i tipi ri-esportati e non
// solo dentro `IndexQuery` perché chi compone una domanda dal canale
// (`host/query.ts`) deve poterlo **nominare**: «voglio i nomi e non il testo
// attorno» è una scelta di chi chiede, non un dettaglio della variante.
export type { Excerpts } from "./enums.generated";

// La forma dichiarata di una sintassi, rispecchiata dal contratto Rust/WIT.
export type SyntaxTrigger =
  | { readonly inline: { readonly open: string; readonly close: string } }
  | { readonly fence: { readonly info: readonly string[] } };

export interface SyntaxForm {
  readonly name: string;
  readonly trigger: SyntaxTrigger | null;
}

// Una interrogazione (rispecchia fub_abi::traits::IndexQuery).
export type IndexQuery =
  | {
      kind: "documents";
      matching: QueryExpr;
      sort?: { key: string; descending: boolean } | null;
      select?: PropertySelect;
      page?: Page | null;
      // Se le righe devono portare l'estratto attorno al match (§21.9).
      // Omesso = "attach": chi non lo nomina riceve una risposta completa.
      // Chi seleziona e basta — un conteggio, una lista di nomi — mette
      // "omit" e non fa generare un estratto per ogni nota che combacia.
      excerpts?: Excerpts;
    }
  | { kind: "backlinks"; target: string; page?: Page | null }
  | { kind: "outline"; doc: string }
  | { kind: "tags"; matching: QueryExpr; page?: Page | null }
  | {
      kind: "neighbors";
      seeds: QueryExpr;
      direction: LinkDirection;
      depth: number;
      page?: Page | null;
    }
  | { kind: "property_values"; key: string; matching: QueryExpr; page?: Page | null }
  | { kind: "vault_health"; check: string; page?: Page | null }
  | { kind: "custom"; ns: string; query: unknown }
  // Questo vault sa quando cambia da fuori? (§9.7) L'unica variante che non
  // chiede niente sul contenuto del vault: chiede del vault stesso. Passa dal
  // canale dati e non da un comando suo perché i suoi due clienti sono già qui
  // — questa shell, e una feature che ha `HostQuery` e nient'altro.
  | { kind: "vault_status" }
  // Cosa sta girando adesso? (§10.3) La seconda variante che chiede del vault e
  // non del suo contenuto, ed è la RICONCILIAZIONE del centro attività:
  // `job_started` e `job_progress` sono recuperabili, quindi i freni del canale
  // possono buttarli, e senza questa domanda quel troncamento sarebbe una
  // perdita definitiva.
  | { kind: "jobs" }
  // Com'è configurato questo vault? (§11.1) La terza che chiede del vault e non
  // del suo contenuto. Torna le impostazioni RISOLTE — schema, valore che vale
  // adesso, livello da cui viene — perché un elenco è dati, e i dati hanno un
  // canale solo. `plugin` assente = tutte.
  | { kind: "settings"; plugin?: string | null }
  // Com'è organizzato questo vault? (§11.3) La quarta che chiede del vault e
  // non del suo contenuto: icone, appuntate, ordinamenti, spazi. Prima era un
  // comando IPC che restituiva il blob intero, cioè una cosa che questa shell
  // sapeva chiedere e un provider no.
  | { kind: "organization" }
  // Cosa nomina questo riferimento, adesso? (§13.1) `from` è il documento
  // dentro cui il riferimento è scritto: serve ai `path`, che sono relativi
  // alla cartella di chi li ospita. Prima era `resolve_link`, un comando IPC
  // scritto apposta — cioè un fatto sul vault che questa shell conosceva e un
  // provider no.
  | { kind: "resolve"; target: LinkTarget; from?: string | null }
  // Cosa c'è nel vault? (§14.1, §14.2) L'anagrafe, non l'indice: è la sola
  // domanda del canale che risponde anche su ciò che non è un documento — un
  // PNG, uno ZIP, un file che nessuno sa cosa sia. `of_kind` assente = tutte le
  // specie. È il canale con cui questa shell costruisce l'albero: prima
  // chiedeva `list_documents`, che restituiva l'intero vault in un `string[]`
  // senza finestra e senza allegati.
  // `within` è la metà che mancava (§14.4): una lista PER CARTELLA, così che
  // aprire un vault da diecimila note non trasferisca diecimila righe per
  // disegnarne venti. Assente = tutto il vault, com'era prima.
  | {
      kind: "entries";
      of_kind?: EntryKind | null;
      within?: FolderScope | null;
      page?: Page | null;
    }
  // Quali cartelle ci sono? (§14.3) Una domanda sua e non una specie in più di
  // `EntryKind`: una cartella non ha dimensione, data né impronta. `under`
  // assente = ogni cartella del vault, a ogni profondità.
  | { kind: "folders"; under?: FolderScope | null; page?: Page | null }
  // COSA È RIMASTO NON SALVATO (§15.2): le bozze che il buffer di crash ha
  // lasciato sul disco. Passa dal canale dati e non da una porta sua per la
  // ragione di `vault_status` — i clienti sono già qui — e per una che è di
  // questa variante soltanto: leggere non è cambiare. È chi decide COSA FARNE a
  // mutare qualcosa, e la scrittura di una bozza ha infatti una porta sua.
  //
  // In coda e non accanto a `vault_health`: l'ordine dei casi è il discriminante
  // dell'ABI, quindi additiva vuol dire in fondo.
  | { kind: "drafts"; page?: Page | null }
  // RENDI QUESTO DOCUMENTO (0163, §16.6). Prima della 0163 l'anteprima passava
  // da un comando IPC bespoke (`render_preview`) che solo la shell sapeva
  // chiamare — un fatto sul vault che questa shell conosceva e un provider no.
  // Ora passa dal canale dati, come l'outline e ogni altra lettura.
  | { kind: "render_preview"; doc: string }
  // RENDI QUESTO RITAGLIO (0163, §16.6): la transclusione `![[page#heading]]` o
  // `![[page#^blocco]]`. Come `render_preview`, prima era un comando IPC suo
  // (`render_embed`) e ora passa dal canale dati.
  | { kind: "render_embed"; page: string; heading?: string | null; block?: string | null }
  // Le forme sintattiche effettive, incluse quelle registrate a runtime.
  | { kind: "syntax_forms"; doc: string }
  // Il bersaglio di stampa percorre gli stessi provider senza usare l'anteprima.
  | { kind: "render_print"; doc: string };

// La risposta (rispecchia fub_abi::traits::IndexResult). Tag ADIACENTE
// (`kind` + `value`): un payload che è una lista o uno scalare non attraversa
// il JSON col tag interno.
export type IndexResult =
  | { kind: "documents"; value: Paged<DocumentMatch> }
  | { kind: "backlinks"; value: Paged<BacklinkRef> }
  | { kind: "outline"; value: Heading[] }
  | { kind: "tags"; value: Paged<TagCount> }
  | { kind: "neighbors"; value: Paged<NeighborRef> }
  | { kind: "property_values"; value: Paged<PropertyCount> }
  | { kind: "vault_health"; value: Paged<HealthIssue> }
  | { kind: "custom"; value: unknown }
  | { kind: "vault_status"; value: VaultStatus }
  | { kind: "jobs"; value: JobStatus[] }
  | { kind: "settings"; value: SettingEntry[] }
  | { kind: "organization"; value: Organization }
  // Il documento che un riferimento nomina, o nessuno. `null` non è un errore
  // ed è metà del valore di questa risposta: legame rotto, URL esterno e nota
  // rinominata via da sotto danno tutti e tre `null`, e chi ha chiesto sa che
  // deve proporre qualcos'altro.
  | { kind: "resolved"; value: ResolvedRef | null }
  | { kind: "entries"; value: Paged<VaultEntry> }
  | { kind: "folders"; value: Paged<VaultFolder> }
  | { kind: "drafts"; value: Paged<DraftInfo> }
  // Il documento reso (risposta a `render_preview`, 0163): l'HTML e le parti
  // dichiarative che la shell monta da sé.
  | { kind: "render_preview"; value: RenderedDocument }
  // Il ritaglio reso (risposta a `render_embed`, 0163): il documento reso e il
  // suo id, perché chi monta un embed deve sapere da quale nota viene.
  | { kind: "render_embed"; value: EmbedContent }
  | { kind: "syntax_forms"; value: SyntaxForm[] }
  | { kind: "render_print"; value: RenderedDocument };

// CHE SPECIE DI FILE È (§14.1). Non è una proprietà del file: è una proprietà
// del file dato chi è registrato adesso — un `.canvas` è `unknown` finché
// nessuno rivendica quell'estensione, e diventa `document` senza che un byte
// cambi. Per questo non si persiste da nessuna parte.
export type { EntryKind } from "./enums.generated";

// Una voce del vault: un file, con ciò che si sa di lui SENZA aprirlo.
export interface VaultEntry {
  // La chiave è il path, come per ogni altra cosa del vault (decisione 0043).
  id: string;
  kind: EntryKind;
  size: number;
  // Ultima modifica in MILLISECONDI unix. Millisecondi perché serve a
  // riconoscere una modifica, non a mostrare una data; non nanosecondi perché
  // oltre 2^53 un intero non sopravvive al `double` del JSON.
  mtime: number;
  // L'identità del CONTENUTO, quando qualcuno l'ha già avuto in mano. `null` è
  // il caso normale per un allegato: leggerne i byte all'apertura è il costo
  // che l'anagrafe esiste per togliere.
  fingerprint: string | null;
}

// Una CARTELLA del vault (§14.3). Esiste perché il disco ce l'ha, non perché il
// path di un file la nomini: una cartella vuota c'è, e una che resta vuota
// perché la sua ultima nota è finita nel cestino resta lì. Prima le cartelle
// vivevano solo qui — le costruiva `buildTree` dai path delle note — e il
// kernel non ne sapeva niente.
export interface VaultFolder {
  // Senza slash finale, mai vuoto: la radice non è una voce.
  path: string;
  // Sottocartelle dirette: è ciò che dice se disegnare la freccetta che apre,
  // senza dover prima chiedere cosa c'è dentro.
  folders: number;
  // File diretti, DI OGNI SPECIE: la domanda è «questa cartella è vuota?», e
  // una con dentro solo un PNG non lo è.
  entries: number;
}

// DOVE guardare, per le domande che si fanno per cartella (§14.3, §14.4). È la
// stessa coppia del predicato `folder`, di proposito: la regola che decide cosa
// ci sta dentro è una sola.
export interface FolderScope {
  // Senza slash finale. "" è la radice del vault.
  path: string;
  // `false` = i soli figli diretti, che è la domanda che disegna un livello di
  // albero.
  descendants: boolean;
}
