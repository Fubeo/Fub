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

I trait sono **object-safe** e **sincroni**: nessun `async fn`, nessun metodo
generico. L'I/O vive nell'`HostApi` (vedi [plugin-boundary.md](plugin-boundary.md)),
non nelle firme dei provider — `parse`/`render`/`serialize` sono CPU-pure.

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

### `HostApi` — `src/traits.rs`

L'unico varco con cui un provider/plugin tocca il mondo esterno. Nativo → oggetto
in-process; WASM (M5) → proxy che reinoltra come host function.

```rust
pub trait HostApi: Send + Sync {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError>;
    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError>;
    fn emit(&mut self, event: Event);
    fn storage_get(&self, key: &str) -> Option<serde_json::Value>;
    fn storage_set(&mut self, key: &str, value: serde_json::Value);
}
```

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

### `IndexProvider` — ricerca e backlink (M2: tantivy)

```rust
pub trait IndexProvider: Send + Sync {
    fn on_document_indexed(&mut self, doc: &DocumentModel);
    fn on_document_removed(&mut self, id: &DocId);
    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;
}
```

`IndexQuery { Backlinks { target }, FullText { query, limit } }`;
`IndexResult { Backlinks(Vec<BacklinkRef>), Search(Vec<SearchHit>) }`;
`BacklinkRef { source, context }`, `SearchHit { doc, score, snippet }`. I metodi
`on_document_*` sono i ganci per l'**aggiornamento incrementale** di M2.

### `EventHandler` — reazione agli eventi

```rust
pub trait EventHandler: Send + Sync {
    fn subscribed(&self) -> EventMask;
    fn handle(&mut self, event: &Event, host: &mut dyn HostApi) -> Result<(), PluginError>;
}
```

`Event { VaultOpened { root }, DocumentChanged { id }, DocumentRemoved { id },
IndexUpdated }`, `EventKind` (stesso set, senza payload), `EventMask(Vec<EventKind>)`.

### `Plugin` — ciclo di vita (M4/M5)

```rust
pub trait Plugin: Send + Sync {
    fn manifest(&self) -> PluginManifest;
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
}
```

`PluginManifest { id, name, version, permissions: PluginPermissions }` e il modello
di permessi in [plugin-boundary.md](plugin-boundary.md).

## Chi implementa cosa, e quando

| Trait | Impl M1 | Prossima impl | Note |
|---|---|---|---|
| `FormatProvider` | `MarkdownProvider` (comrak) ✅ | altri formati (futuro) | unico "sa" del markdown |
| `IndexProvider` | — (backlink via grafo del kernel) | **M2** (tantivy nativo) | ganci incrementali già in firma |
| `ViewProvider` | — (backlink via `build_backlinks_view`) | **M2** (graph/outline/tag) | UI dichiarativa |
| `CommandProvider` | — | **M3** (command palette) | keybinding non vincolante |
| `EventHandler` | — (event bus interno) | **M4/M5** (plugin) | |
| `Plugin` / `HostApi` | firma definita | **M4** (primo plugin nativo) → **M5** (WASM) | confine di fiducia |

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
| `IndexQuery`/`IndexResult`/`BacklinkRef`/`SearchHit` | `variant` / `record` |
| `Event`/`EventKind`/`EventMask` | `variant` / `enum` / `list<event-kind>` |
| `PluginManifest`/`PluginPermissions` | `record` |
| `FormatError`/`PluginError` | `variant` (mappati su `result<_, error>` WIT) |
| `serde_json::Value` (in `attrs`, `args`, storage) | `type json = string` |

**Punto di attenzione noto:** i valori JSON liberi (`attrs`, command `args`,
storage) attraversano il confine come stringa JSON, non come tipo WIT strutturato.
È una scelta deliberata (mantiene l'escape hatch flessibile) da confermare a M4.
