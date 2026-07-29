# M2 — Ricerca + graph + rifiniture

Torna a [../PIANO.md](../PIANO.md) · precede [M3](M3-editor-fidelity.md).

## Obiettivo

Portare FubMD da "editor di note collegate" a "strumento di navigazione della
conoscenza": ricerca full-text, grafo navigabile, pannelli outline/tag, e la
chiusura del ciclo dei link non risolti ("crea nota"). In parallelo, sostituire il
full-rebuild di grafo/indice con un aggiornamento **incrementale**.

## Design

### Indicizzazione full-text (tantivy, incrementale su disco) — **fatto**

`fubmd_features::SearchIndex`, il primo `IndexProvider` nativo, avvolge
**tantivy** (`crates/fubmd-features/src/search.rs`).

- **Persistenza:** indice su disco nello spazio dati del proprio plugin,
  `.fubmd/data/plugins/fubmd.search/` (già ignorato dal walk del vault, vedi
  `crates/fubmd-kernel/src/vault.rs`). Avvio rapido: niente reindicizzazione
  completa ad ogni apertura. Le impronte passano da `HostApi::data_*` — è ciò che
  un index provider di terzi avrà — e la cartella mmap di tantivy dal varco
  nativo `Workspace::plugin_data_dir`.
- **Schema:** `doc_id` (STRING → termine esatto, è ciò che rende `delete_term`
  chirurgico), `page_name` (TEXT, con boost ×4: chi cerca "Rust" vuole prima la
  nota *intitolata* Rust), `body` (TEXT+STORED, dalla proiezione
  `DocumentModel.text`; STORED perché il generatore di snippet rilegge il
  testo), `tags` (TEXT). Lo schema è versionato: un bump forza il rebuild.
- **Aggiornamento incrementale:** `on_document_indexed(doc)` fa
  delete-by-term(`doc_id`) + add; `on_document_removed(id)` fa delete-by-term.
  Il commit non è per-documento: si accumula e si committa al `flush` (lo
  chiama il watcher debounced, che è chi sa quando un lotto è finito) o alla
  prima query con scritture in sospeso — così chi interroga vede sempre le
  proprie scritture.
- **Riapertura senza reindicizzazione:** ogni documento *ripassa* dall'indice
  all'avvio, ma un'impronta del contenuto (FNV-1a stabile, non
  `DefaultHasher`: sopravvive su disco fra due avvii) fa saltare gli immutati.
  Su un vault non toccato la riapertura non produce **nessuna** scrittura — il
  test lo verifica sull'opstamp di tantivy, non a occhio.
- **Impronte e indice sono due file che possono divergere** (crash fra il
  commit e la scrittura del manifest). Il guardiano è l'`opstamp`: il manifest
  cita quello del commit che descrive, e un manifest di un'altra epoca fa
  buttare le **impronte** (non l'indice) e reindicizzare — `delete`+`add` è
  idempotente. Mai il contrario: un manifest creduto valido a sproposito farebbe
  *saltare* documenti, cioè mentire in silenzio.
- **Query:** `IndexQuery::Documents { matching: QueryExpr, … }` →
  `IndexResult::Documents(Paged<DocumentMatch>)`, con `score`, `snippet` e
  `highlights`. Era `IndexQuery::FullText { query, limit }` →
  `Vec<SearchHit>`, e questa riga è rimasta indietro di una decisione: con la
  [decisione 0019](../decisions/0019-il-canale-dati.md) la stringa è diventata un
  **albero** e `SearchHit` si è fuso con `DocumentProperties` in
  `DocumentMatch`. Il testo cercato vive nella foglia
  `QueryPredicate::Text(TextQuery)` e `TextMode::Terms` è la congiunzione di
  default ("rust async" vuole entrambi). Un predicato che il provider non sa
  valutare non è più un errore da interpretare: il routing è **dichiarato**
  (`QueryRoute`) e ciò che nessuno rivendica torna `Unserved`.
- **`snippet` è testo puro, `highlights` sono `Span` al suo interno:** un
  provider non può iniettare markup nella webview privilegiata passando per i
  risultati (vedi [traits.md](../architecture/traits.md)). Il frontend taglia
  sui byte e decodifica — con l'italiano accentato gli indici di carattere non
  coinciderebbero quasi mai.

#### Perché l'indice **non** si alimenta dagli eventi

Il piano originale diceva "l'indice deriva il proprio stato dagli eventi; su
`Event::Overflow` si marca stantio e fa un rebuild completo". Scrivendolo è
emersa una soluzione più forte: il `Workspace` **possiede** gli
`IndexProvider` e li alimenta dentro le stesse operazioni che aggiornano il
grafo. Un indice non può quindi perdere aggiornamenti, e l'`Overflow` per lui
non è più un evento interessante — non c'è nessuno stato stantio da
riconciliare, e nessun rebuild completo da pagare.

Due ragioni indipendenti puntavano nella stessa direzione: (1) un indice che
perde un aggiornamento non smette di rispondere, risponde *sbagliato*, e
un'architettura non dovrebbe rendere possibile una bugia silenziosa quando può
renderla impossibile; (2) `on_document_indexed` riceve il `DocumentModel` già
parsato — l'`Event` porta il solo `DocId`, e chiederlo (`HostApi::read_model`,
[decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md)) costa una
rilettura e un parse per evento.

Resta una sola giuntura: ciò che succede mentre l'indice **non è vivo** (note
cancellate ad app chiusa). La chiude `IndexProvider::reconcile(ids)`, che
riceve la verità completa del vault in coda a `reindex`. `Event::Overflow`
mantiene tutto il suo valore per il *frontend*, che invece deriva davvero il
proprio stato dagli eventi.

### La ricerca predefinita è di classe *omnisearch* ([decisione 0025](../decisions/0025-la-ricerca-predefinita.md)) — **dichiarata**, non ancora vera

Ciò che M2 ha spedito è un motore full-text esatto: `TextMode::Terms`,
congiunzione di default, boost ×4 sul nome, un estratto per nota. Funziona, ed è
la base giusta — ma non è ancora ciò che un utente di Obsidian intende per
«la ricerca funziona», che è il comportamento dell'estensione **omnisearch**:
refusi perdonati, prefisso mentre si digita, più occorrenze per nota su cui si
può saltare, e un secondo modale che cerca *dentro* la nota aperta.

La [0025](../decisions/0025-la-ricerca-predefinita.md) ha deciso che quel
comportamento è **la ricerca dell'app** e non un plugin installabile — sotto non
c'è una ricerca "base" da migliorare, e dalla stessa porta passano quick
switcher, palette, collezioni e `vault.replace`. Il che rende tre pezzi
**firma**, quindi scadenti col freeze di [M4](M4-wit-hardening.md):

- `TextMode` non sa dire «a meno di un refuso» — né, di conseguenza,
  «esattamente», che è ciò che serve a chi poi **scrive** ([§21.1](../roadmap/21-la-ricerca-predefinita.md#211-la-tolleranza-ai-refusi-non-è-dicibile-nel-contratto));
- non c'è modo di dire che l'ultimo termine è ancora incompleto, e se lo aggiunge
  la casella di ricerca allora CLI, automazioni e LLM interrogano lo stesso
  indice in una lingua diversa ([§21.2](../roadmap/21-la-ricerca-predefinita.md#212-il-prefisso-mentre-si-digita-non-è-uneuristica-della-casella));
- `DocumentMatch.highlights` sono span dentro `snippet` e non dentro il
  documento, quindi `ViewUpdate::Reveal` — che la shell sa già eseguire per
  l'outline — non ha coordinate da ricevere ([§21.3](../roadmap/21-la-ricerca-predefinita.md#213-gli-estratti-sono-ancorati-allo-snippet-non-al-documento)).

Le altre sei voci (superfici, pesi, allegati, e la misura che non torna) stanno
nella [seduta 21](../roadmap/21-la-ricerca-predefinita.md). Nessuna di esse
rimette in discussione ciò che questa milestone ha fatto: l'indice persistente e
incrementale, il routing dichiarato e il linguaggio delle query restano, e sono
esattamente ciò su cui quel comportamento si appoggia.

### Grafo incrementale (insieme all'indice) — **fatto**

`Workspace::rebuild_graph` ricostruiva `LinkGraph` da zero ad ogni modifica.
Ora `LinkGraph::upsert`/`LinkGraph::remove` applicano un delta per-documento
(`crates/fubmd-kernel/src/graph.rs`); `Workspace` li usa su
`write_document`/`refresh_from_disk`/`remove_document`.

Il problema vero non è aggiungere gli archi del documento toccato, ma sapere
**chi altro va ri-risolto**: creare `Nota.md` ruba il nome `nota` a `sub/Nota.md`
e sposta i link di terzi. L'invariante che rende il delta trattabile è che la
risoluzione di una chiave `K` dipende solo da `path_index[strip_ext(K)]`,
`name_index[K]`, `alias_index[K]`. Da lì due mappe di dipendenza inversa:
`watchers` (chiave d'indice → chiavi di link che ne dipendono) e `refs_by_key`
(chiave di link → documenti che la usano). Costo proporzionale al vicinato.

- `alias_index` e `path_index` diventano multi-mappe ordinate come `name_index`
  (vince il path più corto, poi lessicografico). Con la vecchia
  `HashMap<String, DocId>` due alias uguali — o `a.md` e `a.txt`, stesso path
  senza estensione — si sovrascrivevano nell'ordine casuale della `HashMap` dei
  modelli; e comunque serviva sapere **chi subentra** quando il vincitore sparisce.
- **Correttezza prima di tutto:** il full-rebuild resta come oracolo e come
  fallback dietro `Workspace::set_graph_update(GraphUpdate::FullRebuild)`.
- Misura indicativa (5000 documenti, 200 modifiche, release): ~12 µs a modifica
  contro ~19 ms del rebuild completo.

### Cache dei modelli: metadata ≠ body (insieme all'indice)

Oggi il `Workspace` tiene il `DocumentModel` **completo** (albero `body` +
proiezione `text`, ≈2× la sorgente) di *tutto* il vault, per sempre: conflazione
di due cache con vite diverse. Da sdoppiare quando arriva l'indice:

- **metadata cache** (globale, sempre in RAM): `outline`/`links`/`tags` +
  frontmatter — è ciò che serve a grafo, pannelli e risoluzione;
- **body parsato** (solo documenti aperti/anteprima, LRU piccola): serve al
  rendering; si riparsa on-demand dalla sorgente;
- `text` non resta in RAM: alimenta tantivy all'indicizzazione e poi vive
  nell'indice su disco.

Obsidian fa lo stesso (metadata cache persistente, niente AST globale in RAM).
Farlo a M2 e non prima: è lo stesso refactor dei percorsi incrementali, e
l'oracolo full-rebuild appena costruito verifica che nulla cambi.

### Backlink come `ViewProvider` — **fatto**

Il pannello backlink era una funzione libera (`build_backlinks_view`) che l'app
riempiva di dati già calcolati: UI dichiarativa sì, ma non un provider. Ora è
`fubmd_features::BacklinksView`, il **primo `ViewProvider` vero**, e il primo a
percorrere il protocollo per intero — non solo il rendering ma anche il giro
azione→`ViewUpdate`.

Per esserlo servivano due capacità che l'`HostApi` non aveva, ed è la
migrazione ad averle fatte emergere (stesso meccanismo del dogfooding del
versioning): `query_index` (la view chiede i backlink al vault, non li riceve) e
`active_context` (la view sa quale nota è aperta, dove sta il cursore e in che
modalità si legge). Le decisioni — perché una
capacità di lettura e non un evento, perché non un argomento di `render_view` —
sono in [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md),
"Interrogazione e contesto". Il giro chiude nel renderer generico del frontend
(comandi `render_view`/`view_action`/`set_active_context`), non più nel comando
ad-hoc `backlinks_view` né nel parsing `open:` lato client. Le view di M2 ancora
da fare (graph-data, outline, tag) nascono su questo stesso giro.

### Graph view (Canvas/WebGL nel frontend)

- Un `ViewProvider` nativo espone **solo i dati** del grafo: nodi (`DocId`,
  `page_name`, grado) e archi (sorgente→target risolti, da `outgoing`).
- Il **rendering** è un componente frontend dedicato (Canvas 2D, con opzione WebGL
  per vault grandi): layout force-directed, pan/zoom, click→`Navigate { doc_id }`,
  evidenziazione del vicinato. **Non** passa dal protocollo `UiNode` (vedi la
  regola dell'escape hatch in [../architecture/ui-protocol.md](../architecture/ui-protocol.md)).
- Modalità: grafo globale e grafo locale (n-hop dal documento aperto).

### Outline panel e tag panel — **fatti**

- **Outline:** `fubmd_features::OutlineView`, secondo `ViewProvider` vero. Non
  legge `DocumentModel.outline` direttamente (una view non ha il modello): lo
  chiede al kernel con **`IndexQuery::Outline`**, il *canale metadata* aperto
  proprio da qui — senza, un plugin non potrebbe ricavare la struttura di un
  documento, non avendo un `FormatProvider`. Il click su un heading è un nuovo
  **`ViewUpdate::Reveal { doc_id, span }`**; il frontend porta l'editor
  sull'intervallo convertendo byte UTF-8 → code unit UTF-16
  (`frontend/src/rules/offsets.ts`, verificato su testo accentato+emoji). La gerarchia
  si vede col rientro nel titolo (spazio EM) in attesa di un eventuale `UiNode`
  ad albero. E2e: `crates/fubmd-features/tests/outline_view_e2e.rs`.
- **Tag panel:** `fubmd_features::TagPanelView`, terzo `ViewProvider`. Aggrega i
  tag dell'intero vault con **`IndexQuery::Tags`** (canale metadata; il kernel
  conta per **nota**, non per occorrenza, dai `DocumentModel`). Il click su un
  tag è un **`ViewUpdate::RunSearch { query }`** — la shell riusa il pannello di
  ricerca esistente con `tags:<nome>` (i tag sono un campo indicizzato). Oggi è
  una `List` piatta `#a/b` con il conteggio; l'albero di tag e un `UiNode`
  tree-node restano un affinamento. E2e:
  `crates/fubmd-features/tests/tags_view_e2e.rs`.

### Flusso "crea nota" (link non risolti) — **fatto**

Oggi `resolve_wiki` restituisce `None` per un wikilink senza target. M2:
- il frontend distingue i wikilink risolti da quelli non risolti (data-attribute
  già presente nell'HTML di anteprima);
- click su un link non risolto → comando "crea nota": nome dal `page` del
  `LinkTarget::Wiki`, path secondo le regole del vault, poi `write_document` di uno
  scheletro e navigazione. Naturale candidato per il primo `CommandProvider`
  (altrimenti cablato nell'app fino a M3).

Chiuso (vedi [PIANO.md](../PIANO.md), "Decisioni"): `Workspace::create_note`
+ comando IPC `create_note`, cablato nell'app — e cablato è **rimasto** finché
l'`HostApi` non ha avuto le capacità per farne un comando vero. Con la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) le ha:
adesso è `note.create` (`free_name` + `create_document`), il comando IPC non
esiste più, e il click su un link non risolto è il chiamante che questa voce
aspettava dal principio. La nota nasce vuota,
non da uno scheletro: un template è una preferenza, e le preferenze arrivano coi
settings. Il backlink compare da solo, perché il link nel documento di partenza
non viene toccato ed è il grafo a risolverlo di nuovo.

### Registro dei comandi e palette ([decisione 0009](../decisions/0009-registro-dei-comandi.md) + [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md)) — **fatto**, anticipato da M3

Il `CommandProvider` era l'unico trait del contratto senza un solo chiamante:
esisteva la firma, non il registro. Ora il `Workspace` ha
`register_command_provider`/`commands`/`invoke_command`, l'IPC ha
`list_commands`/`invoke_command` (gemelli di `list_views`/`view_action`), e la
shell ha una **palette** che non cabla nessun id — legge le spec, disegna un
campo per ogni parametro dichiarato, mostra il piano quando il raggio lo merita.

È stato fatto insieme alla [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md) (un comando descritto a una **macchina**) perché
sono la stessa firma vista da due lati, e le firme costano un campo prima del
freeze e una migrazione dopo: `CommandSpec` porta ora descrizione, parametri
tipati e raggio dichiarato, e `invoke` prende un `InvokeMode` — la rottura di
firma fatta adesso, con la linea di base ritagliata in `crates/fubmd-abi/wit/frozen/0.1.0.wit`.

Le due cose che l'host **fa rispettare**, e che sono la differenza fra un
registro leggibile e uno eseguibile da terzi: gli argomenti sono convalidati
contro la spec prima che il comando venga chiamato, e chi simula (o si è
dichiarato di sola lettura) riceve un `HostApi` che rifiuta le scritture — quindi
il dry-run non è una convenzione fra chiamante e comando. Il verbale delle
decisioni, con ciò che resta fuori, è nella [decisione 0009](../decisions/0009-registro-dei-comandi.md) e nella [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md).

Clienti veri nello stesso giro: `CoreCommands` (`search.open`,
`selection.wikilink` — che compone contesto di sessione [decisione 0007](../decisions/0007-contesto-di-sessione.md) ed edit chirurgico
[decisione 0008](../decisions/0008-modifica-chirurgica.md) —, `vault.replace` con anteprima del piano su N note) e la palette.
E2e: `crates/fubmd-kernel/tests/invoke_command.rs`,
`crates/fubmd-features/tests/commands_e2e.rs`.

### Il lotto e l'origine degli eventi ([decisione 0011](../decisions/0011-il-lotto.md) + [decisione 0012](../decisions/0012-origine-degli-eventi.md)) — **fatto**

Il kernel mutava un documento alla volta e non aveva modo di dire che N di quelle
mutazioni sono **una** operazione. Il caso era già in repo e si vedeva a occhio:
una rinomina con 200 backlink riscriveva 200 sorgenti, ognuna con il suo
`index_updated`, e la shell rispondeva a ciascuno con un `list_documents` più il
ridisegno di ogni view iscritta — 201 ridisegni completi per una cosa che
l'utente ha chiesto una volta.

Le due voci sono state fatte insieme perché la [decisione 0012](../decisions/0012-origine-degli-eventi.md) lo dichiara essa stessa:
il campo che chiedeva è «origin **e** l'id di lotto della [decisione 0011](../decisions/0011-il-lotto.md)». Deciderle
separate significava deciderle due volte, la seconda con la prima già congelata.

`Workspace::batch(|ws| …)` è uno scope: dentro, `index-updated` non viene emesso
(è l'unico evento senza payload, quindi l'unico di cui N copie dicono quanto ne
dice una) e alla chiusura arriva un `Event::BatchEnded { batch, changed }`.
Gli eventi **per-documento passano tutti**, quindi nessun handler esistente ha
dovuto cambiare. Un lotto **non è una transazione** e non si chiama come se lo
fosse: non annulla niente, e chi lo ha aperto scopre cosa non è andato dal
proprio valore di ritorno — il tutto-o-niente vuole il journal del §15.2.

Un handler riceve ora un `Notice { event, origin }`, con
`Origin { actor, batch }` e `Actor { User, Watcher, Kernel, Plugin { id } }`.
L'attore è **chi ha chiesto**, non chi ha eseguito: è l'unica lettura per cui il
campo esiste, e senza di essa l'automazione su-modifica di 16.2 si richiama da
sola finché il `DISPATCH_BUDGET` non tronca. È la seconda rottura di firma del
giro — `event-handler.handle` prendeva un `event` nudo — con la linea di base
ritagliata in `crates/fubmd-abi/wit/frozen/0.1.0.wit`; e `invoke_command` ha guadagnato un
`by: Actor`, perché un'invocazione attribuita a un default è l'errore che 16.2
esiste per non fare.

Il verbale, con ciò che resta fuori, è nella [decisione 0011](../decisions/0011-il-lotto.md) e nella [decisione 0012](../decisions/0012-origine-degli-eventi.md).

Clienti veri nello stesso giro: `rename_document` (che *è* un lotto: 201
ridisegni → 1), ogni `invoke_command(…, Apply)` — quindi `vault.replace` su N
note, con l'origine di chi ha invocato — e la shell, che ridisegna una volta e
distingue «un'altra applicazione ha scritto questo file» da «lo abbiamo riscritto
noi». E2e: `crates/fubmd-kernel/tests/batch_and_origin.rs`,
`crates/fubmd-features/tests/{commands_e2e,view_refresh_masks}.rs`.

### Le capacità dell'`HostApi`, chiuse ([decisione 0013](../decisions/0013-elenco-delle-capacita.md)) — **fatto**, prima del freeze

La superficie più esposta del contratto è quella che il freeze rende definitiva
nel modo più caro: una capacità che manca è una feature che non potrà mai essere
un plugin, aggiungerne una dopo costa una minor e toglierne una una major.
L'elenco è stato chiuso deciso **una voce per volta e a verbale**, comprese
quelle che restano fuori — perché una saltata in silenzio è indistinguibile, fra
sei mesi, da una scartata apposta.

Dentro: le **operazioni strutturali** (`create_document`, `rename_document`,
`trash_document`, `list_trash`, `restore_document`, `empty_trash`) e
`run_command`. Fuori: `storage_get`/`storage_set`, **tolte** — la sola rottura
del giro, con la linea di base ritagliata in `crates/fubmd-abi/wit/frozen/0.1.0.wit`.

Le decisioni che il freeze avrebbe reso definitive, in breve: `create_document`
**rifiuta** un path occupato (è l'unica differenza con `write_document`, ed è
quella che impedisce a un template che sbaglia la data di cancellare una nota
vera); di rename ce n'è **uno**, quello che riscrive i backlink, perché due
semantiche sotto lo stesso nome sono la trappola in cui un plugin scritto contro
l'una si comporta come l'altra; `list_trash` sta accanto a `list_documents` e non
in `IndexQuery`, perché il cestino non è indicizzato; `run_command` non prende né
modo né attore né lotto — li **eredita**, così una simulazione non diventa reale
invocando qualcuno e una macro di tre comandi resta una cosa sola. Il permesso
`write_vault` resta al §7.3, ma il varco che **nega** copre già tutte e sei le
strutturali: manca il registro dei manifest, non il rifiuto.

Il verbale completo, capacità per capacità e con le ragioni di ciò che non
entra, è nella [decisione 0013](../decisions/0013-elenco-delle-capacita.md).

Cliente vero nello stesso giro: le cinque azioni strutturali della shell migrate
a `CoreCommands` (`note.create`, `note.rename`, `note.trash`, `trash.restore`,
`trash.empty`), con **sei comandi Tauri spariti** — ed è quella sparizione a
rendere vera la regola del §16.6 anche per le feature che toccano il vault — più
`vault.archive`, che sposta N note invocando `note.rename` e non nomina un solo
link. E2e: `crates/fubmd-kernel/tests/structural_host.rs`,
`crates/fubmd-kernel/tests/invoke_command.rs`,
`crates/fubmd-features/tests/commands_e2e.rs`.

## Trait/API coinvolti

- `IndexProvider` (nuova impl nativa, tantivy) — [traits.md](../architecture/traits.md).
- `CommandProvider` (registro, dry-run, palette: [decisione 0009](../decisions/0009-registro-dei-comandi.md) + [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md)) — prima impl
  `CoreCommands`, anticipata da M3.
- `ViewProvider` (backlink ✅, outline ✅, tag ✅; graph-data da fare) — dati via [ui-protocol.md](../architecture/ui-protocol.md).
- `HostApi::query_index` (col canale metadata `IndexQuery::Outline`/`Tags`) + `HostApi::active_context` — le capacità che rendono una view un provider vero.
- `HostApi` **chiusa** ([decisione 0013](../decisions/0013-elenco-delle-capacita.md)): strutturali + `run_command` dentro, `storage_*` fuori — 22 metodi, poi 24 con `read_model` e `format_of` ([decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md)).
- `Workspace` in `fubmd-kernel`: nuovi percorsi incrementali per grafo+indice.
- `CommandProvider` per "crea nota" — fatto: `note.create`, e con esso gli altri
  quattro strutturali ([decisione 0013](../decisions/0013-elenco-delle-capacita.md)).
- Comandi IPC in `fubmd-app`: search, graph-data, outline, tags — e **sei in
  meno**, perché crea/rinomina/cestina/ripristina/svuota/proponi-nome sono
  diventati comandi del registro.

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| tantivy **incrementale su disco** | Scala a vault grandi e dà avvio rapido; i ganci `on_document_*` esistono già nel trait. |
| Ricerca **built-in di classe *omnisearch***, non un plugin ([decisione 0025](../decisions/0025-la-ricerca-predefinita.md)) | Sotto non c'è una ricerca "base" da migliorare: due motori sullo stesso vault sarebbero due indici, due ranking e due risposte alla stessa domanda. E la tolleranza ai refusi va nel **contratto** e non dentro il provider, perché deve poter essere **spenta per singola query**: lo stesso `IndexQuery::Documents` serve la casella di ricerca e `vault.replace`. |
| Indici **posseduti e alimentati dal kernel**, non dagli eventi | Un indice che perde un aggiornamento non tace: risponde sbagliato, in silenzio. La coda eventi ha un budget; questo canale no. Vedi sopra, "Perché l'indice non si alimenta dagli eventi". |
| `reconcile(ids)` + `flush(host)` **aggiunti al trait** a M2 | Le due giunture che restano: ciò che cambia ad app chiusa, e il fatto che il kernel scriva un documento alla volta mentre un indice vuole scrivere a lotti. Il freeze è a M4: la firma si corregge ora o mai più. |
| `activate(host)` + `flush(host)` con l'**`HostApi`** nella firma | Senza, un index provider di terzi in WASM non potrebbe persistere nulla: stesso buco che il versioning aveva trovato per `EventHandler`. L'host arriva nei due punti in cui lo stato attraversa il disco, e in nessun altro — vedi [traits.md](../architecture/traits.md), `IndexProvider`. |
| `snippet` testo + `highlights: Vec<Span>` | Un provider di terzi non deve poter iniettare markup nella webview privilegiata passando per i risultati di ricerca (stessa regola di `UiNode::Html`). |
| Backlink **serviti dal grafo**, non dall'indice | Il grafo conosce le regole di risoluzione dei wikilink e le ambiguità dell'intero vault: duplicarli creerebbe una seconda verità che può divergere dalla prima. |
| Grafo **incrementale insieme** all'indice | Stessa natura del problema (delta per-documento); evita due passaggi di refactor sul `Workspace`. |
| Graph view **Canvas/WebGL**, fuori da `UiNode` | Performance su migliaia di nodi; il dichiarativo non regge il force-directed. |
| Outline/tag **via `ViewProvider`+`UiNode`** | Sono liste: restano dichiarative, dogfood del protocollo. |
| "crea nota" come **comando** | Riusa `HostApi.write_document`; anticipa `CommandProvider` senza attendere M3. |

## Criteri di accettazione

- Ricerca full-text su un vault di ≥1000 note con risultati rilevanti < 50 ms a
  query (indice caldo), snippet evidenziati. ✅ misurato su 2000 note (release,
  vocabolario ristretto = caso peggiore): query peggiore **108 µs**, indice
  costruito da zero in 25 ms. **Ma la spunta va letta con un asterisco**: il
  banco della [decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)
  ha misurato ~**23 ms** per query passando dal workspace, cioè due ordini di
  grandezza sopra. Nessuno dei due numeri è sbagliato, quindi i due banchi
  misurano cose diverse — ed è la [§21.9](../roadmap/21-la-ricerca-predefinita.md#219-una-query-costa-23-ms-su-duemila-note-e-nessuno-sa-perché),
  che esiste perché «la ricerca è veloce» non sia una frase spuntata su una
  misura che non copre il caso vero.
- Riapertura del vault **senza** reindicizzazione completa (indice caricato da
  disco). ✅ **13,9 ms** per 2000 note, con **zero** scritture sull'indice
  (verificato sull'opstamp di tantivy, non a occhio).
- Modifica/creazione/cancellazione di una nota: grafo e indice riflettono il
  cambiamento senza full-rebuild, e il risultato è **identico** a quello del
  full-rebuild. ✅ per entrambi, ciascuno col proprio oracolo.
- Graph view naviga (click→apertura), pan/zoom fluidi su vault grande; grafo locale
  n-hop.
- Outline e tag panel funzionanti; click naviga (heading via `Span`, tag via ricerca).
- Click su wikilink non risolto crea la nota e ci naviga.

## Piano di test

- **Unit dell'indice** (`crates/fubmd-features/src/search.rs`, in-module): match
  su corpo/titolo/tag, boost del titolo, congiunzione di default, delete-by-term
  senza duplicati, `reconcile`, query malformata → `BadArgs`. E i tre casi che
  contano davvero, perché falliscono in silenzio: riapertura che salta gli
  immutati, manifest di un'altra epoca (crash simulato fra commit e manifest) e
  indice corrotto — che si ricostruisce invece di farsi diagnosticare.
- **Alimentazione degli indici** (`crates/fubmd-kernel/tests/index_feeding.rs`):
  una spia al posto di tantivy, così il test parla del contratto e non
  dell'implementazione. Verifica che write/remove/rename arrivino, che
  `reconcile` arrivi *dopo* l'alimentazione e prima del `flush`, che i backlink
  non raggiungano mai i provider, che una query attraversi chi risponde
  `BadArgs` — e che un indice riceva il suo aggiornamento **anche quando la
  coda eventi trabocca**.
- **Proprietà:** su una sequenza casuale di write/remove, `grafo_incrementale ==
  LinkGraph::build(tutti)` e `indice_incrementale == indice_da_zero` (oracolo =
  full-rebuild attuale). Per il grafo: `crates/fubmd-kernel/tests/graph_incremental.rs`
  (universo ostile: omonimi a profondità diverse, alias che collidono con i nomi,
  path che collidono a meno dell'estensione; generatore xorshift deterministico,
  niente `proptest`) e `tests/workspace_incremental.rs` per lo stesso confronto
  passando da disco/provider/eventi. Per l'indice:
  `crates/fubmd-features/tests/search_e2e.rs`, che ricostruisce lo stato finale
  in un vault vergine e confronta le risposte.
- **E2e** (`crates/fubmd-features/tests/search_e2e.rs`): vault vero, markdown
  vero, tantivy vero. Modifica/cancellazione/rename riflessi nella ricerca
  (nessun fantasma dopo un rename), riapertura che non scrive nulla su un vault
  immutato, riapertura che recupera cancellazioni/modifiche/creazioni avvenute
  ad app chiusa, highlight allineati su testo accentato.
- **Ancora da fare a M2:** creazione nota da link non risolto → il backlink
  compare (`crates/fubmd-format-markdown/tests/vault_e2e.rs`).
- **Bench:** ignorati nel giro normale, si eseguono a mano in release.
  `crates/fubmd-kernel/tests/graph_incremental.rs` per grafo incrementale vs
  rebuild; `crates/fubmd-features/tests/search_e2e.rs` per la latenza di query
  e la riapertura a freddo su 2000 note (i numeri nei criteri qui sotto).
- **Nota emersa dal bench:** un secondo `SearchIndex` sulla stessa cartella
  trova il lock del writer di tantivy occupato. È il caso di due istanze di
  FubMD sullo stesso vault: si rinuncia alla ricerca nella seconda, **non** si
  butta l'indice della prima (che è vivo e corretto). Se il multi-istanza
  diventerà un requisito, servirà un vero coordinamento — oggi non lo è.
- `cargo test --workspace` + `cargo clippy` verdi su tutti gli OS (vedi
  [../appendix/platforms-ci.md](../appendix/platforms-ci.md)).

## Rischi / mitigazioni

- **Divergenza incrementale vs rebuild** → test di proprietà con oracolo; fallback a
  rebuild dietro un flag finché il test non è stabile.
- **Corruzione/lock dell'indice su disco** → *risolto*: schema versionato,
  confronto dello schema all'apertura e rebuild automatico se qualcosa non
  torna. Un indice è stato derivato, non si diagnostica: si butta. Se non si
  apre affatto, il vault si apre lo stesso **senza ricerca** — la verità è il
  vault, e un indice guasto non deve impedire di leggere le proprie note.
- **Perf del force-directed** → soglia note oltre cui si passa a WebGL / si mostra
  solo il grafo locale; **loggare** eventuali cap (niente troncamenti silenziosi).
- **`IndexProvider` non implementato da nessuno a M1** → M2 è la sua prima prova:
  se la firma è scomoda, correggerla *ora* (il freeze è a [M4](M4-wit-hardening.md)).
