# Superficie dei trait di estensione

Tutti i trait di estensione sono definiti **una volta sola** in `fubmd-abi`
(`src/format.rs` e `src/traits.rs`). Le feature ufficiali li implementano in modo
nativo; i plugin di terzi (M5) li implementeranno via proxy WASM. **Il kernel vede
sempre `dyn Trait`** e non sa quale backend c'è dietro.

Torna a [../PIANO.md](../PIANO.md) · vedi [data-model.md](data-model.md),
[ui-protocol.md](ui-protocol.md), [plugin-boundary.md](plugin-boundary.md).

## Regola d'oro

Ogni argomento e ogni valore di ritorno di ogni trait è:
- un tipo di `fubmd-abi`, `Serialize + Deserialize`;
- esprimibile come **record/variant/resource WIT**;
- senza reference con lifetime nella memoria del kernel, senza trait object nelle
  firme dei dati, senza closure.

I trait sono **object-safe**, **sincroni** e — per contratto — **brevi**: nessun
`async fn`, nessun metodo generico. L'I/O vive nell'`HostApi` (vedi
[plugin-boundary.md](plugin-boundary.md)), non nelle firme dei provider —
`parse`/`render`/`serialize` sono CPU-pure. Il lavoro **lungo** (rete, calcolo
pesante) non sta dentro nessuna chiamata sincrona: passa dai **job**
(`HostApi::spawn_job` → `Plugin::run_job` → `Event::JobDone`), eseguiti
dall'host fuori dal giro sincrono del kernel — è la storia di concorrenza del
contratto, vedi [plugin-boundary.md](plugin-boundary.md), "Lavoro lungo: i job".

Questa regola non è più solo un'asserzione: da **M2** un `wit/fubmd/*.wit` vivente
la rende verificabile ad ogni commit (vedi [M4](../milestones/M4-wit-hardening.md)
per il congelamento formale).

## I sette trait

Le firme qui sotto sono la copia fedele del contratto (`fubmd-abi`). Se il codice
diverge, il codice ha ragione: aggiornare questo documento.

### `FormatProvider` — `src/format.rs`

L'astrazione centrale su "come si comporta un formato". Markdown è il primo
provider (nativo, `fubmd-format-markdown`).

```rust
pub trait FormatProvider: Send + Sync {
    fn descriptor(&self) -> FormatDescriptor;
    fn capabilities(&self) -> FormatCapabilities;
    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError>;
    fn render_html(&self, model: &DocumentModel, opts: &RenderOptions) -> Result<String, FormatError>;
    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError>;
}
```

Tipi di supporto: `FormatDescriptor { id, name, extensions }`,
`FormatCapabilities { wikilinks, tags, frontmatter, callouts, embeds }`,
`ParseContext { doc_id, parse_tags, parse_wikilinks }` (helper `::obsidian(id)`),
`RenderOptions { wikilinks_as_data_attrs }`.

Due semantiche fissate nel contratto:

- **`serialize` è generazione, non round-trip** — la fonte di verità di un
  documento esistente è la sorgente; le modifiche programmatiche sono patch
  via `Span` (vedi [data-model.md](data-model.md), "Fonte di verità").
- **`render_html` è puro per-documento** — niente `HostApi`, quindi niente
  transclusion nel provider: gli embed escono come placeholder e la
  composizione è di kernel+frontend (`Workspace::render_embed`, vedi
  [ui-protocol.md](ui-protocol.md), "Transclusion").

### `HostApi` — `src/traits.rs`

L'unico varco con cui un provider/plugin tocca il mondo esterno. Nativo → oggetto
in-process; WASM (M5) → proxy che reinoltra come host function.

```rust
pub trait HostApi: Send + Sync {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError>;
    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError>;
    fn list_documents(&self) -> Result<Vec<DocId>, PluginError>;
    fn emit(&mut self, event: Event);
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError>;
    // stato leggero e volatile
    fn storage_get(&self, key: &str) -> Option<serde_json::Value>;
    fn storage_set(&mut self, key: &str, value: serde_json::Value);
    // storage persistente per-plugin (namespace imposto dall'host)
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError>;
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError>;
    fn data_remove(&mut self, path: &str) -> Result<(), PluginError>;
    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError>;
    // il tempo è una capacità come le altre
    fn now_unix_millis(&self) -> u64;
    // interrogazione del vault e contesto della sessione (le ha chieste la view)
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;
    fn active_document(&self) -> Option<DocId>;
}
```

`JobSpec { job, payload }` e `JobId(u64)` sono il varco del **lavoro lungo**:
`spawn_job` accoda e ritorna subito; l'esito arriva come `Event::JobDone` con lo
stesso `JobId` (il lanciatore lo conserva e riconosce il proprio). Il corpo del
job è `Plugin::run_job` (vedi sotto), eseguito fuori dal kernel.

**Le ultime tre famiglie di metodi le ha chieste il dogfooding.** Il versioning
è un `EventHandler` scritto come lo scriverebbe un plugin, e nella sua prima
stesura scriveva lo store con `std::fs` e leggeva l'ora da `fubmd_kernel::time`:
funzionava da nativo, e un plugin WASM con l'`HostApi` di allora non avrebbe
potuto farlo. Il buco era **nel contratto**, ed è stato chiuso lì — prima del
freeze di M4, non aggirato:

- `data_*` — storage persistente per-plugin. Il plugin nomina **blob** con path
  relativi; lo spazio (`.fubmd-data/plugins/<id>/`) lo assegna e lo impone
  l'host, che rifiuta path assoluti, `..` e separatori di sistema con
  `PermissionDenied`. Vedi [plugin-boundary.md](plugin-boundary.md), "Storage".
- `now_unix_millis` — l'orologio dell'host. Un componente WASM può non averne
  uno (WASI lo può negare) e un host che lo fornisce lo rende deterministico nei
  test: le fasce di ritenzione del versioning si provano avanzando un orologio
  finto, non piantando timestamp nelle strutture interne dello store.
- `list_documents` — senza, `read_document` serve solo per gli id che arrivano
  dagli eventi: nessun plugin potrebbe reagire a `VaultOpened` guardandosi
  intorno, né costruire alcunché sull'intero vault.

**Le ultime due le ha chieste la migrazione dei backlink a `ViewProvider`** — lo
stesso meccanismo del dogfooding, un caso reale che scopre un buco nel contratto.
Una view che non può interrogare il vault né sapere quale nota è aperta non è un
provider, è un guscio che l'app riempie:

- `query_index` — la porta di `Workspace::query_index` aperta ai provider, stesso
  dispatch (backlink dal grafo, resto dai provider registrati). `&self`: una
  query non muta, e così una view la serve sotto prestito condiviso, dalla parte
  giusta della concorrenza.
- `active_document` — il documento con il focus della sessione, l'unico contesto
  di sessione che il contratto espone. La view lo **chiede**; a scriverlo è solo
  la shell (`Workspace::set_active_document`), mai un plugin. Scartati l'evento
  (`render_view(&self)` è immutabile) e l'argomento di `render_view` (obbligo per
  ogni view a portarsi un contesto che non usa) — vedi
  [plugin-boundary.md](plugin-boundary.md), "Interrogazione e contesto".

L'identità del plugin (`<id>`) la assegna **chi registra**
(`Workspace::register_event_handler(id, handler)`), non il plugin: chi si
sceglie il recinto da sé non è dentro a un recinto. `Workspace::with_host(id, f)`
presta lo stesso `HostApi` a chi compone le due metà di una feature dall'esterno
del dispatch — è così che l'app apre lo store delle versioni e ne rilegge una,
senza un canale privilegiato che un plugin non avrebbe.

### `CommandProvider` — comandi (M3: command palette)

```rust
pub trait CommandProvider: Send + Sync {
    fn commands(&self) -> Vec<CommandSpec>;
    fn invoke(&self, command: &str, args: serde_json::Value, host: &mut dyn HostApi)
        -> Result<CommandOutcome, PluginError>;
}
```

`CommandSpec { id, title, keybinding: Option<String> }`,
`CommandOutcome { notify: Option<String> }`.

### `ViewProvider` — UI dichiarativa (M2: graph/outline/tag panel)

```rust
pub trait ViewProvider: Send + Sync {
    fn views(&self) -> Vec<ViewSpec>;
    fn render_view(&self, view: &str, host: &dyn HostApi) -> Result<UiNode, PluginError>;
    fn on_action(&self, view: &str, action: UiAction, host: &mut dyn HostApi)
        -> Result<ViewUpdate, PluginError>;
}
```

`ViewSpec { id, title, placement: ViewPlacement }` con
`ViewPlacement { LeftSidebar, RightSidebar, Bottom }`. `UiNode`/`UiAction`/
`ViewUpdate` sono in [ui-protocol.md](ui-protocol.md).

**I provider veri: `BacklinksView` e `OutlineView`.** Il pannello backlink è
passato da funzione libera a `ViewProvider` (`fubmd-features`), ed è ciò che ha
esercitato il trait per intero — e fatto emergere `query_index`/`active_document`
nell'`HostApi`. Non riceve dati: in `render_view` chiede il documento attivo e i
suoi backlink all'host, in `on_action` traduce il click in `ViewUpdate::Navigate`.
Il giro chiude nel renderer generico del frontend (comandi `render_view`/
`view_action`/`set_active_document`), non più in un comando ad-hoc.

L'outline è il secondo provider e il primo a usare il **canale metadata**: chiede
gli heading del documento attivo con `IndexQuery::Outline` e traduce il click in
`ViewUpdate::Reveal { doc_id, span }`, che porta l'editor sull'heading (lo `span`
è in byte UTF-8, il frontend lo mappa su CodeMirror col ponte in
`frontend/src/offsets.ts`). Il tag panel è il terzo: aggrega i tag del vault con
`IndexQuery::Tags` e traduce il click in `ViewUpdate::RunSearch { query }`, che la
shell esegue riusando il pannello di ricerca. Prove end-to-end col kernel vero:
`crates/fubmd-features/tests/{backlinks,outline,tags}_view_e2e.rs`.

**Il varco unico degli alberi di UI.** I provider si registrano con
`Workspace::register_view_provider(id, trust, provider)`, dove
`Trust { Trusted, Untrusted }` dice **di chi** ci si fida (non *cosa* è
ammesso: lo stesso `UiNode::Html` è legittimo da una feature ufficiale e
inaccettabile da un plugin sandboxato). Ogni albero entra nell'host da
`Workspace::render_view` / `Workspace::view_action`, e lì — in un punto solo —
`UiNode::validate_untrusted` rifiuta il contenuto attivo di un provider non
fidato, a qualunque profondità e anche quando arriva come `ViewUpdate::Replace`
in risposta a un click. Oggi nessun provider non fidato esiste e la validazione è
un no-op: il punto esiste **prima** del primo, perché aggiungerlo dopo vorrebbe
dire cercarlo fra N chiamanti (vedi `crates/fubmd-kernel/tests/view_trust.rs`).

### `IndexProvider` — ricerca (M2: tantivy)

```rust
pub trait IndexProvider: Send + Sync {
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn on_document_indexed(&mut self, doc: &DocumentModel);
    fn on_document_removed(&mut self, id: &DocId);
    fn reconcile(&mut self, ids: &[DocId]);
    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;
}
```

`IndexQuery { Backlinks, FullText, Outline, Tags, Neighbors, Properties,
PropertyValues, VaultHealth, Custom }` — è il **canale dati verso le view**, e
ciò che non è esprimibile qui diventa un comando bespoke dell'app, cioè una
superficie che un plugin non potrà mai avere. Le risposte stanno in
`IndexResult`, con gli stessi nomi.

Le forme che portano: `BacklinkRef { source, context }`,
`SearchHit { doc, score, snippet, highlights: Vec<Span> }`,
`NeighborRef { doc, via, depth }`, `TagCount { name, count }`,
`DocumentProperties { doc, properties: Vec<PropertyEntry> }`,
`PropertyCount { value, count }`, `HealthIssue { doc, check, detail, span }`.

**La finestra è nella domanda.** `Page { offset, limit }` sta nella query e
`Paged<T> { items, offset, total }` nella risposta: `None` al posto della `Page`
significa "tutto", e `total` è il conteggio *prima* della finestra — senza, chi
disegna non sa se esiste una pagina dopo. Chi sa paginare alla sorgente lo fa
(tantivy usa `offset`/`limit` del collector e un `Count` per il totale); chi
risponde da una mappa già in memoria ritaglia con `Paged::window`. L'unica
risposta senza finestra è `Outline`: cresce con **un** documento, non col vault.
Al confine WIT i generici non esistono, e ogni istanza è un record a sé
(`backlinks-page`, `search-page`, …).

**L'ambito è dato, non sintassi.** `FullText` porta uno `SearchScope { folders,
tags }` accanto alla stringa: la stringa è il linguaggio del provider, l'ambito
è del contratto — una shell che offre "cerca in questa cartella" non deve
comporre sintassi altrui, e un provider diverso non può interpretarlo
diversamente. `PropertyFilter { key, test: PropertyTest }` fa lo stesso per il
frontmatter: `exists`/`missing`/`equals`/`contains`/`>`/`<` su
`PropertyValue` (§1.5), in AND fra loro.

**L'alimentazione non passa dagli eventi.** Il `Workspace` possiede gli
`IndexProvider` registrati e chiama `on_document_*` *dentro* le stesse
operazioni che aggiornano il grafo. È deliberato e asimmetrico rispetto a
`EventHandler`: la coda eventi ha un budget e può troncare (`Event::Overflow`),
e un indice che perde un aggiornamento non smette di rispondere — risponde
**sbagliato**, in silenzio. In più `on_document_indexed` riceve il
`DocumentModel`, che un handler non avrebbe modo di ottenere: l'`HostApi` dà la
sorgente, non il modello parsato.

Restano due giunture, ed è il compito degli altri due metodi:

- `reconcile(ids)` — `ids` è l'insieme **completo** dei documenti del vault e
  ciò che l'indice ha in più è morto. Chiude l'unico modo in cui un indice
  persistente può divergere: quel che succede mentre non è vivo (una nota
  cancellata ad app chiusa). Il kernel lo chiama in coda a `reindex`. Non è un
  rebuild — gli immutati non vanno reindicizzati, ed è ciò che rende rapida la
  riapertura di un vault.
- `flush(host)` — punto di consistenza **e di persistenza**. Il kernel scrive
  **un documento alla volta**, un indice vuole scrivere **a lotti**: fra un
  `on_document_*` e il `flush` il provider è libero di accumulare. Chi decide che
  il lotto è finito non è il kernel (non lo sa) ma chi il lotto lo ha formato —
  nell'app, il watcher debounced. Chi interroga senza aspettare un flush vede
  comunque le proprie scritture: lo garantisce il provider, non il chiamante.

**Dove sta l'`HostApi`, e perché non è su ogni metodo.** Un indice persistente
deve poter **caricare e salvare** il proprio stato, e l'unico storage durevole
del contratto è `data_*`: con nessun host in nessuna firma — com'era fino al
secondo audit — un index provider di terzi in WASM non avrebbe potuto persistere
*nulla*. È lo stesso buco che il versioning aveva fatto emergere per
`EventHandler`, e come quello va chiuso **prima** del freeze di M4: dopo, la
firma è un breaking change.

L'host arriva nei due punti in cui lo stato attraversa il disco, e non altrove:

- `activate(host)` — chiamata **una volta**, alla registrazione, prima di
  qualunque alimentazione: è il punto in cui un indice ritrova ciò che ha già
  visto. `SearchIndex` ci carica il manifest delle impronte, ed è quel
  riconoscimento a rendere rapida la riapertura di un vault non toccato. Dopo il
  primo `on_document_indexed` sarebbe troppo tardi per averlo.
- `flush(host)` — l'unico punto in cui un indice **scrive**.
- `on_document_*` e `reconcile` sono mutazioni in memoria: dare l'host qui
  costringerebbe il kernel a prestare `&mut Workspace` dentro il ciclo di
  alimentazione, cioè a duplicare il modello appena parsato a ogni salvataggio.
- `query` prende `&self` e il kernel serve le interrogazioni sotto prestito
  **condiviso** del workspace: un host per-query lo prenderebbe in esclusiva, il
  contrario della direzione in cui va la concorrenza (`Mutex` → `RwLock`).

L'host è **per-chiamata** e non un handle conservato alla costruzione perché è
l'unica forma che regge entrambi i backend: un handle dovrebbe essere `'static`
(la regola d'oro vieta i lifetime nelle firme) e l'host del kernel *è* un
prestito `&mut Workspace`, che `'static` non può essere.

Come per gli `EventHandler`, l'identità la assegna chi registra —
`Workspace::register_index_provider(id, index)`, che registra **e attiva** — e
determina lo spazio dati concesso. `SearchIndex` è registrato con
`SEARCH_ID = "fubmd.search"`.

**Il caso di tantivy, e il varco che ha richiesto.** Il manifest passa da
`data_*`; la cartella dei segmenti no, e non potrebbe: un motore di ricerca
mmappa i propri file e li rilegge quando gli pare, anche dai thread di merge, e
in quei momenti non ha un host da chiamare. Il path arriva da
`Workspace::plugin_data_dir(id)` — una vera cartella, **dentro lo stesso
recinto** di `data_*`. È un varco per il codice nativo, dichiarato come tale e
non una capacità del contratto; a M5 il suo equivalente per un componente è un
preopen WASI sulla stessa radice. Ciò che la firma garantisce è che un provider
di terzi *possa* persistere, non che tutti persistano allo stesso modo.

**Quasi tutte le query le serve il kernel, non i provider.**
`Workspace::query_index` risponde direttamente a `Backlinks` e `Neighbors` (dal
grafo), `Outline` (dai `DocumentModel` di un documento), `Tags` e
`Properties`/`PropertyValues` (dai metadati dell'intero vault), `VaultHealth`
(dal grafo e dai link in cache): hanno tutte una sola fonte di verità *dentro*
il kernel, e duplicarla in un indice creerebbe una seconda verità divergente.
Sono anche il **canale metadata** — il modo con cui una view legge struttura,
tag e proprietà senza avere un `FormatProvider` (che, essendo un plugin, non
ha): stesso canale (`HostApi::query_index`), stesso dispatch. Ai provider, in
ordine di registrazione, va il resto — oggi il full-text: vince il primo che non
risponde `BadArgs`, che per contratto significa "non è roba mia".

**`snippet` è testo, mai markup.** L'evidenziazione viaggia separata, in
`highlights: Vec<Span>` (byte *dentro* `snippet`): un provider di terzi non
deve poter iniettare contenuto attivo nella webview privilegiata passando per
i risultati di ricerca — è la stessa regola di `UiNode::Html` in
[ui-protocol.md](ui-protocol.md). Chi disegna avvolge gli intervalli con i
propri elementi, e nel farlo attraversa il ponte byte→UTF-16.

`Custom` è il **varco di estensione** (namespaced: `ns` = plugin id): senza,
gli enum chiusi + il freeze WIT di M4 obbligherebbero il contratto a prevedere
in anticipo ogni query futura — e i plugin di terzi non potrebbero definirne
di proprie. `ns` sconosciuto → `PluginError::BadArgs`.

### `EventHandler` — reazione agli eventi

```rust
pub trait EventHandler: Send + Sync {
    fn subscribed(&self) -> EventMask;
    fn handle(&mut self, event: &Event, host: &mut dyn HostApi) -> Result<(), PluginError>;
}
```

`Event { VaultOpened { root }, DocumentChanged { id }, DocumentRemoved { id },
DocumentRenamed { from, to }, IndexUpdated, JobDone { id, job, result },
Overflow { dropped }, Custom { topic, payload } }`,
`EventKind` (stesso set, senza payload), `EventMask(Vec<EventKind>)`.

- `DocumentRenamed` esiste perché **l'identità è il path**: un rename non è
  remove+add (vedi [data-model.md](data-model.md), "Identità e rename").
- `JobDone { id, job, result }` è il rientro dei **job** (vedi `HostApi` sopra
  e [plugin-boundary.md](plugin-boundary.md)): l'esito del lavoro in background
  consegnato sul giro sincrono normale. Le eventuali scritture le fa l'handler
  che lo riceve — mai il job stesso.
- `Overflow { dropped }` segnala che la coda eventi è stata **troncata** (budget
  anti-ping-pong esaurito): `dropped` eventi non sono stati consegnati. Chi
  deriva stato dagli eventi (indice, grafo, cache, frontend) deve considerarlo
  stantio e **riconciliare da zero**. È la versione rumorosa del troncamento:
  perdite silenziose non esistono per contratto.
  Chi tiene stato **per-documento** deve abbonarsi anche a `Overflow`, e non è
  una raccomandazione di stile: perdere un `DocumentChanged` costa un
  aggiornamento in ritardo, perdere un `DocumentRenamed` o un `DocumentRemoved`
  lascia lo stato derivato a *mentire* su chi esiste e con che nome. La
  riconciliazione parte da `HostApi::list_documents`, che è lì per questo (vedi
  `VersioningHandler::reconcile_after_overflow` come esempio di riferimento).
- `Custom { topic, payload }` è il varco per gli eventi dei plugin (topic
  namespaced `"<plugin-id>/<nome>"`): è anche il canale con cui i plugin
  comunicano fra loro. L'abbonamento è a grana `EventKind::Custom`; il filtro
  sul topic è dell'handler.

**Dispatch (deciso, implementato in `fubmd-kernel`):** gli handler girano
dentro al kernel **a coda, mai ricorsivamente**. Ogni operazione mutante del
`Workspace` accoda i propri eventi e li drena alla fine; un handler che durante
`handle` emette eventi o scrive documenti via `HostApi` accoda — non rientra —
e un budget di drenaggio tronca i ping-pong infiniti fra handler. Il
troncamento è **rumoroso**: al posto degli eventi persi arriva un
`Event::Overflow { dropped }` (sul bus e agli handler; ciò che viene emesso
gestendo l'`Overflow` è a sua volta scartato, unico modo di garantire la
terminazione). Durante il drenaggio gli handler sono estratti dal workspace,
così l'`HostApi` presta `&mut Workspace` senza aliasing (il nodo di ownership
che rendeva il dispatch il punto più delicato del contratto). Vedi
`workspace.rs` e `tests/rename_and_events.rs`.

### `Plugin` — ciclo di vita (M4/M5)

```rust
pub trait Plugin: Send + Sync {
    fn manifest(&self) -> PluginManifest;
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn run_job(&self, job: &str, payload: serde_json::Value)
        -> Result<serde_json::Value, PluginError> { /* default: UnknownJob */ }
}
```

`run_job` è il corpo di un job richiesto via `HostApi::spawn_job`, eseguito
dall'host **fuori** dal kernel. Deliberatamente **senza `HostApi`**: il job è
puro rispetto al vault — input nel `payload`, output nel risultato; le
scritture le fa chi riceve il `JobDone`, dentro il giro sincrono normale.
Default fornito (`UnknownJob`): la maggior parte dei plugin non ha job.

`PluginManifest { id, name, version, permissions: PluginPermissions }` e il modello
di permessi in [plugin-boundary.md](plugin-boundary.md).

## Chi implementa cosa, e quando

| Trait | Impl M1 | Prossima impl | Note |
|---|---|---|---|
| `FormatProvider` | `MarkdownProvider` (comrak) ✅ | altri formati (futuro) | unico "sa" del markdown |
| `IndexProvider` | — (backlink via grafo del kernel) | `SearchIndex` (tantivy) **M2** ✅ | `activate`/`flush` con `HostApi`: persiste via `data_*` |
| `ViewProvider` | `BacklinksView`, `OutlineView`, `TagPanelView` ✅ **M2** | **M2** (graph-data) | tre provider veri; `query_index`+`active_document`; canale metadata (`Outline`/`Tags`); `ViewUpdate` `Navigate`/`Reveal`/`RunSearch` |
| `CommandProvider` | — | **M3** (command palette) | keybinding non vincolante |
| `EventHandler` | dispatch a coda nel kernel ✅ | **M4/M5** (plugin) | anti-rientranza, vedi sopra |
| `Plugin` | firma definita | **M4** (primo plugin nativo) → **M5** (WASM) | confine di fiducia |
| `HostApi` | `KernelHost` nel `Workspace` ✅ | **M4** (permessi) → **M5** (host function) | storage in-memory per ora |

A M1 backlink e anteprima passano dal grafo/registry del kernel, non ancora da
`IndexProvider`/`ViewProvider`: la superficie è definita per intero (è il valore
del crate-contratto), ma cablata progressivamente.

## Tabella di esprimibilità WIT (la regola d'oro, resa verificabile)

Ogni tipo che attraversa una firma di trait mappa su un costrutto WIT. Questa
tabella è il checklist di conformità di M4; il `wit/` vivente di M2 la
materializza in `wit/fubmd/*.wit` + test abi↔WIT.

| Tipo abi | Costrutto WIT |
|---|---|
| `DocId(String)` | `type doc-id = string` |
| `Span { start: usize, end: usize }` | `record span { start: u64, end: u64 }` — vedi "Larghezze" sotto |
| `Frontmatter(Map<String,Value>)` | `type json = string` (JSON serializzato) |
| `DocumentModel` | `record document-model { … }`, con `body: document-tree` |
| `Block` / `Inline` (alberi) | `variant block` / `variant inline` **in arena**: `list<block-ref>` / `list<inline-ref>` al posto dei figli diretti, nodi in `document-tree` |
| `LinkTarget` | `variant link-target { wiki(link-target-wiki), url(string), path(string) }` |
| `Link` / `Heading` / `Tag` / `Anchor` | `record` |
| `ListItem` / `TaskMarker` / `TableRow` / `TableCell` | `record` (dentro l'arena: `list-item.blocks` è `list<block-ref>`, `table-cell.inlines` è `list<inline-ref>`) |
| `ColumnAlign` | `enum column-align { none, left, center, right }` |
| `PropertyValue` / `PropertyScalar` | `variant` — la lista porta gli scalari, perché WIT non ha tipi ricorsivi |
| `PropertyDate` / `PropertyTime` | `record` (`s32` per l'anno, `option<s16>` per il fuso) |
| `FormatDescriptor`/`FormatCapabilities`/`ParseContext`/`RenderOptions` | `record` |
| `CommandSpec`/`CommandOutcome` | `record` |
| `ViewSpec`/`ViewPlacement` | `record` / `enum` |
| `UiNode` (albero) | `variant ui-node` **in arena**: `list<ui-ref>` fra i figli, nodi in `ui-tree` |
| `UiAction`/`ViewUpdate` | `record` / `variant` (`replace(ui-tree)`) |
| `IndexQuery`/`IndexResult` | `variant` — ogni caso con più di un argomento ha il suo record (`index-query-neighbors`, `index-query-properties`, …) |
| `BacklinkRef`/`SearchHit`/`NeighborRef`/`TagCount`/`DocumentProperties`/`PropertyEntry`/`PropertyCount`/`HealthIssue` | `record` |
| `Page` / `Paged<T>` | `record page` / **un record per istanza** (`backlinks-page`, `search-page`, `tags-page`, `neighbors-page`, `properties-page`, `property-values-page`, `vault-health-page`): al confine i generici non esistono |
| `SearchScope`/`PropertyFilter`/`PropertySort` | `record` |
| `PropertyTest` | `variant` (i casi senza valore — `exists`, `missing` — non portano payload) |
| `LinkDirection`/`HealthCheck` | `enum` |
| `Event`/`EventKind`/`EventMask` | `variant` (incl. `document-renamed`, `job-done`, `overflow`, `custom`) / `enum` / `list<event-kind>` |
| `JobSpec`/`JobId` | `record job-spec` / `type job-id = u64` (interface `jobs`) |
| `PluginManifest`/`PluginPermissions` | `record` |
| `FormatError`/`PluginError` | `variant` (mappati su `result<_, error>` WIT) |
| `serde_json::Value` (in `attrs`, `args`, storage) | `type json = string` |

**Punto di attenzione noto:** i valori JSON liberi (`attrs`, command `args`,
storage) attraversano il confine come stringa JSON, non come tipo WIT strutturato.
È una scelta deliberata (mantiene l'escape hatch flessibile) da confermare a M4.

### Alberi ricorsivi al confine: arena, non JSON

`Block`, `Inline` e `UiNode` sono **ricorsivi**, e WIT non ammette tipi
ricorsivi. La ricorsione via `list<ui-node>` che questa tabella dava per buona è
una proposta aperta del component model, non una feature: il contratto scritto
così non passava nemmeno il parser. La contaminazione era transitiva —
`DocumentModel.body` rendeva inesprimibili `FormatProvider` e
`on_document_indexed`, `ViewUpdate::Replace` faceva lo stesso con `render_view`.

Le due strade erano l'**arena** e la **stringa JSON**. Si è scelta l'arena:

| | Arena (`list<nodo>` + indici `u32`) | Stringa JSON |
|---|---|---|
| Tipi al confine | restano record/variant WIT, campo per campo | un `string` opaco |
| Conformità abi↔WIT | verificabile: il test confronta campi e casi | niente da confrontare |
| Costo | una conversione albero↔arena nel proxy | serializzazione + parsing a ogni chiamata |

La stringa JSON avrebbe fatto sparire dal contratto proprio la parte che il
contratto esiste per fissare: il modello di documento. L'escape hatch JSON resta
dov'era — `attrs`, `args`, storage — cioè dove il contenuto è **per definizione**
libero, non dove è la struttura che tutti condividono.

In pratica: `Vec<Inline>` diventa `list<inline-ref>` (`inline-ref = u32`),
`Vec<Block>` diventa `list<block-ref>`, e i nodi veri vivono in
`record document-tree { blocks, inlines, roots }` (per l'UI,
`record ui-tree { nodes, root }`). **I tipi Rust nativi non si toccano**: restano
alberi veri, con l'ergonomia degli alberi.

**La conversione esiste già, e non nel proxy: è `fubmd_abi::arena`.** Una
rappresentazione al confine *dichiarata* e mai prodotta da nessun codice sarebbe
una promessa non verificata proprio al momento del freeze; il proxy di M5 non la
reimplementerà, la chiamerà. Il modulo contiene i mirror piatti
(`arena::Block`/`Inline`/`UiNode`, con gli indici come **newtype** — scambiare un
indice di blocco con uno di inline è un bug che il compilatore intercetta),
`DocumentTree`/`UiTree` con `flatten`/`rebuild`, e `arena::Span` con le due
conversioni di larghezza. Le proprietà sono sotto test:

- **round-trip** albero→arena→albero identità, su un corpo che tocca ogni
  variante e annida a più livelli;
- **indici fuori range** e **cicli** sono `ArenaError`, non panic e non loop: chi
  manda un'arena può essere un plugin sbagliato o ostile, e un'arena è solo *una
  lista con dei numeri dentro*. (Due riferimenti allo stesso nodo — un DAG — non
  sono un ciclo: il controllo guarda il *percorso*, non i visitati.)
- **`usize`↔`u64`** con `From` e `TryFrom`, e gli span che restano attaccati al
  nodo giusto dopo l'appiattimento, che riordina tutto.

Il legame fra i mirror e gli alberi nativi lo tiene il compilatore:
`flatten`/`rebuild` sono match esaustivi sui due lati, quindi una variante nuova
in `model::Block` non compila finché non entra anche nell'arena.

### Larghezze e keyword

- **`Span` è `usize` in Rust e `u64` nel WIT.** I campi indicizzano `&str` in
  memoria; obbligarli a `u64` metterebbe un `as usize` su ogni slice del kernel
  per compiacere un confine che il kernel non attraversa. `usize`→`u64` è sempre
  lecita; `u64`→`usize` su wasm32 (`usize` a 32 bit) passa da una conversione
  controllata — un documento oltre i 4 GiB non entrerebbe comunque nella memoria
  di un modulo. La divergenza non è più solo dichiarata: è `arena::Span` con
  `From<model::Span>` e `TryFrom` nell'altro verso, e il test di conformità
  confronta il `record span` del WIT con **quello del confine**, non col nativo.
- **`list`, `result` e `from` sono keyword WIT** e nel contratto compaiono
  con l'escape `%` (`%list`, `%result`, `%from`). È sintassi del linguaggio:
  l'identificatore dichiarato resta quello, e i campi Rust
  (`Event::DocumentRenamed { from, to }`, `Event::JobDone { result }`) non si
  rinominano per una questione di grammatica altrui.

### Come la conformità è verificata

`crates/fubmd-abi/tests/wit_conformance.rs` **parsa** `wit/fubmd/abi.wit` con
`wit-parser` (dev-dependency: l'invariante di `fubmd-abi` riguarda le dipendenze
normali) e confronta **nomi e tipi dichiarati**, non sottostringhe del sorgente.
Quattro pressioni:

1. un WIT che non parsa è rosso;
2. un tipo Rust che cambia **non compila** più il test — i record si
   destrutturano per intero, i variant si esauriscono in un `match`, e le
   funzioni sono *cast dei metodi dei trait a puntatore a funzione*, quindi un
   parametro o un ritorno diverso è un errore di compilazione;
3. nomi **e tipi** confrontati nelle due direzioni: campi dei record (in
   ordine — in un record l'ordine è la disposizione al confine, in un variant è
   il discriminante), payload dei casi, destinazioni degli alias, firme complete
   delle funzioni; ciò che il WIT dichiara e l'abi non rivendica è contratto
   morto e fallisce ugualmente;
4. **`host` è eliso**: nessuna funzione del WIT può avere un parametro `host`,
   anche là dove il metodo Rust prende un `&mut dyn HostApi` — le capacità si
   importano dal world, e questa è la verifica che prima non c'era.

Il punto delicato è **da dove vengono i tipi attesi**: non sono scritti a mano.
`wit(&campo)` deduce la forma WIT dal tipo Rust del campo destrutturato, e
`WitFn` deduce parametri e risultato dal tipo del puntatore a funzione. Se
`SearchHit::score` diventasse `f64`, l'attesa diventerebbe `f64` e il confronto
col contratto (`f32`) fallirebbe — è il caso che il vecchio confronto per soli
nomi non avrebbe visto. È il "non compila su divergenza" chiesto dall'audit,
ottenuto senza generare codice.

E c'è il test del test: **quattordici** divergenze introdotte ad arte — campo
rinominato, caso rimosso, funzione sparita, tipo di troppo, alias con la
larghezza sbagliata, tipo di un campo cambiato, payload di un caso cambiato,
risultato di una funzione cambiato, parametro rinominato o ritipato, `host`
riapparso, campi e casi riordinati — devono tutte far diventare rosso il test.
Limite dichiarato: l'**ordine** dei casi di un variant è confrontato con l'ordine
in cui il test li elenca, non con quello dell'enum Rust (il compilatore
garantisce che ci siano tutti, non che siano in fila).
