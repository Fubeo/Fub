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
    fn emit(&mut self, event: Event);
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError>;
    fn storage_get(&self, key: &str) -> Option<serde_json::Value>;
    fn storage_set(&mut self, key: &str, value: serde_json::Value);
}
```

`JobSpec { job, payload }` e `JobId(u64)` sono il varco del **lavoro lungo**:
`spawn_job` accoda e ritorna subito; l'esito arriva come `Event::JobDone` con lo
stesso `JobId` (il lanciatore lo conserva e riconosce il proprio). Il corpo del
job è `Plugin::run_job` (vedi sotto), eseguito fuori dal kernel.

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

### `IndexProvider` — ricerca (M2: tantivy)

```rust
pub trait IndexProvider: Send + Sync {
    fn on_document_indexed(&mut self, doc: &DocumentModel);
    fn on_document_removed(&mut self, id: &DocId);
    fn reconcile(&mut self, ids: &[DocId]);
    fn flush(&mut self) -> Result<(), PluginError>;
    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;
}
```

`IndexQuery { Backlinks { target }, FullText { query, limit }, Custom { ns, query } }`;
`IndexResult { Backlinks(Vec<BacklinkRef>), Search(Vec<SearchHit>), Custom(Value) }`;
`BacklinkRef { source, context }`,
`SearchHit { doc, score, snippet, highlights: Vec<Span> }`.

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
- `flush()` — punto di consistenza. Il kernel scrive **un documento alla
  volta**, un indice vuole scrivere **a lotti**: fra un `on_document_*` e il
  `flush` il provider è libero di accumulare. Chi decide che il lotto è finito
  non è il kernel (non lo sa) ma chi il lotto lo ha formato — nell'app, il
  watcher debounced. Chi interroga senza aspettare un flush vede comunque le
  proprie scritture: lo garantisce il provider, non il chiamante.

**I backlink non passano dai provider.** `Workspace::query_index` serve
`IndexQuery::Backlinks` dal grafo del kernel, che è la loro unica fonte di
verità — conosce le regole di risoluzione dei wikilink e le ambiguità
dell'intero vault. Duplicarli in un indice creerebbe una seconda verità che può
divergere dalla prima. Tutto il resto va ai provider in ordine di
registrazione: vince il primo che non risponde `BadArgs`, che per contratto
significa "non è roba mia".

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
| `IndexProvider` | — (backlink via grafo del kernel) | **M2** (tantivy nativo) | ganci incrementali già in firma |
| `ViewProvider` | — (backlink via `build_backlinks_view`) | **M2** (graph/outline/tag) | UI dichiarativa |
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

| Tipo abi | Costrutto WIT previsto |
|---|---|
| `DocId(String)` | `type doc-id = string` |
| `Span { start, end }` | `record span { start: u64, end: u64 }` |
| `Frontmatter(Map<String,Value>)` | `type json = string` (JSON serializzato) |
| `DocumentModel` | `record document-model { … }` |
| `Block` / `Inline` | `variant block` / `variant inline` |
| `LinkTarget` | `variant link-target { wiki(wiki-link), url(string), path(string) }` |
| `Link` / `Heading` / `Tag` | `record` |
| `FormatDescriptor`/`FormatCapabilities`/`ParseContext`/`RenderOptions` | `record` |
| `CommandSpec`/`CommandOutcome` | `record` |
| `ViewSpec`/`ViewPlacement` | `record` / `enum` |
| `UiNode` | `variant ui-node` (ricorsivo via `list<ui-node>`) |
| `UiAction`/`ViewUpdate` | `record` / `variant` |
| `IndexQuery`/`IndexResult`/`BacklinkRef`/`SearchHit` | `variant` (incl. `custom(index-query-custom)`) / `record` |
| `Event`/`EventKind`/`EventMask` | `variant` (incl. `document-renamed`, `job-done`, `overflow`, `custom`) / `enum` / `list<event-kind>` |
| `JobSpec`/`JobId` | `record job-spec` / `type job-id = u64` (interface `jobs`) |
| `PluginManifest`/`PluginPermissions` | `record` |
| `FormatError`/`PluginError` | `variant` (mappati su `result<_, error>` WIT) |
| `serde_json::Value` (in `attrs`, `args`, storage) | `type json = string` |

**Punto di attenzione noto:** i valori JSON liberi (`attrs`, command `args`,
storage) attraversano il confine come stringa JSON, non come tipo WIT strutturato.
È una scelta deliberata (mantiene l'escape hatch flessibile) da confermare a M4.
