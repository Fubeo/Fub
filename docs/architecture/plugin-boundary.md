# Confine dei plugin: `Plugin`, `HostApi`, capability

Questo documento descrive il **confine di fiducia** tra il core e un plugin —
nativo (M4) o WASM (M5). Il principio: il kernel vede `dyn Trait` e non distingue
un backend dall'altro; la differenza è tutta nel *come* le chiamate attraversano
il confine e in *quali capacità* il core concede.

Torna a [../PIANO.md](../PIANO.md) · vedi [traits.md](traits.md).

## `HostApi`: l'unico varco

Un plugin non tocca mai il filesystem o il bus direttamente: passa da `HostApi`
(vedi firma in [traits.md](traits.md)). Questo dà **un solo punto** in cui
applicare i permessi.

- **Nativo (M4):** `HostApi` è un oggetto in-process che chiama direttamente il
  `Workspace` (già implementato: `KernelHost` in `fubmd-kernel/src/workspace.rs`,
  usato dal dispatch degli eventi — a coda, mai ricorsivo, vedi
  [traits.md](traits.md)). Costo ≈ zero.
- **WASM (M5):** il plugin riceve un *proxy* di `HostApi`; ogni metodo è una **host
  function** wasmtime che serializza gli argomenti, attraversa il confine, esegue
  nel core e ritorna. La firma è identica: per questo la regola d'oro impone tipi
  serializzabili.

### Storage: due, e diversi apposta (deciso)

Un plugin ha due modi di ricordare, e la differenza non è un dettaglio
implementativo — è nella firma, così che nessuno debba indovinare:

| | `storage_get/set` | `data_read/write/remove/list` |
|---|---|---|
| Forma | chiave → JSON | path → blob di byte |
| Durata | **volatile**, muore con la sessione | persistente |
| Per cosa | preferenze, cursori, ciò che si ricostruisce | ciò che è la verità di quel plugin |

Lo spazio persistente è `.fubmd-data/plugins/<id>/`, **dentro al vault**: i dati
derivati da un vault appartengono a quel vault, e copiarlo o metterlo in sync se
li porta dietro.

**Perché blob e non un'API filesystem scoped.** Un filesystem scoped chiede al
plugin di comporre path e all'host di verificarli: il recinto diventa una
convenzione, e ogni convenzione ha il giorno in cui qualcuno se ne dimentica.
Con i blob il plugin non ha mai in mano un path del filesystem, non sa dove sia
la radice del vault e non può nominare niente che stia fuori — path assoluti,
`..` e separatori di sistema sono `PermissionDenied`. Il recinto è una proprietà
della firma.

**L'unica eccezione, e sta fuori dal contratto.** Un provider **nativo** che
avvolge un motore con un proprio formato su disco non può passare da `data_*`:
tantivy mmappa i propri segmenti e li rilegge quando gli pare, anche dai thread
di merge, e in quei momenti non ha un host da chiamare. Per questi c'è
`Workspace::plugin_data_dir(id)`, che restituisce **la stessa cartella** del
recinto come path del filesystem. È un metodo del workspace e non una capacità
dell'`HostApi`, deliberatamente: così un plugin WASM non ce l'ha, e resta scritto
nero su bianco *chi* può usarlo. A M5 l'equivalente per un componente è un
preopen WASI sulla stessa radice — che è la forma in cui il component model
concede un filesystem, e mantiene il recinto dove è sempre stato.

**Chi assegna `<id>`.** Chi registra il plugin
(`Workspace::register_event_handler(id, handler)`), mai il plugin: uno che si
sceglie il proprio recinto non è dentro a un recinto. La verifica sta in
`crates/fubmd-kernel/tests/plugin_data.rs`.

**Perché esiste.** Non è stato progettato in astratto: lo ha chiesto il
dogfooding del versioning, che è un `EventHandler` come quelli di terzi e con
l'`HostApi` precedente non avrebbe potuto tenere il proprio store — vedi
[traits.md](traits.md), `HostApi`. Il buco è stato chiuso nel contratto prima
del freeze di M4, e `VersionStore` è la prova che la firma regge un caso reale.

### Interrogazione e contesto (deciso)

Due capacità dell'`HostApi`, aggiunte prima del freeze perché senza di esse un
`ViewProvider` non è un provider ma un guscio che l'app riempie di dati già
pronti — un dogfooding finto. Le ha chieste, come per lo storage, il primo caso
reale: il pannello backlink migrato a view (`fubmd_features::BacklinksView`).

- **`query_index(&self, IndexQuery) -> Result<IndexResult, PluginError>`** — la
  view interroga il vault da sé invece di ricevere i dati già pronti. È la
  stessa porta di `Workspace::query_index` e lo stesso dispatch: quasi tutte le
  query le serve il **kernel** dalle proprie fonti di verità — backlink e vicini
  dal grafo (`Backlinks`, `Neighbors`), outline, tag e proprietà dai
  `DocumentModel` (`Outline`, `Tags`, `Properties`, `PropertyValues`), la salute
  del vault da entrambi (`VaultHealth`) — e ai provider registrati va il resto,
  oggi il full-text. È il **canale metadata**: senza, una view non potrebbe
  leggere né la struttura parsata né il frontmatter, perché non ha un
  `FormatProvider` con cui parsare. È `&self`: una query non muta, e così
  una view la serve sotto il prestito *condiviso* del workspace, senza entrare in
  conflitto con la direzione della concorrenza (`Mutex`→`RwLock`).

  Le risposte che crescono col vault portano una **finestra** (`Page` nella
  domanda, `Paged { items, offset, total }` nella risposta): una view che
  mostra venti righe non fa materializzare centomila righe a chi la serve, e
  `total` le dice che ce n'è ancora. Ometterla significa "tutto", ed è quello
  che fanno i pannelli che disegnano un insieme intero (tag, backlink di una
  nota).

- **`active_context(&self) -> Option<ViewContext>`** — il contesto di sessione:
  *quale pannello ha il focus, che nota guarda, cosa c'è selezionato dentro, in
  che modalità*. Una view lo **chiede** quando serve (il pannello backlink a
  ogni render). Il kernel lo custodisce in `Workspace::context`; a scriverlo è
  **solo** la shell, con `set_active_context` a ogni navigazione, movimento del
  cursore o cambio di modalità. Non c'è un gemello che scrive nell'`HostApi`:
  "quale nota guardo e dove ho cliccato" è una decisione dell'utente sull'app,
  non una capacità da concedere a un plugin.

  Due strade scartate, entrambe per una ragione di forma: un **evento** che la
  view segue (`render_view(&self)` è immutabile — una view non può accumulare
  stato dagli eventi senza interior mutability) e un **argomento** di
  `render_view` (costringerebbe *ogni* view — grafo, settings — a portarsi un
  contesto che non usa). La capacità che si chiede a domanda non ha nessuno dei
  due difetti.

  Non è un `DocId` nudo perché con schede, split e finestre multiple (FEATURES
  4.1) "il documento attivo" smette di essere una variabile globale: due
  pannelli backlink affiancati farebbero la stessa domanda e riceverebbero la
  stessa risposta, sbagliata per uno dei due. Il `PaneId` dentro il contesto è
  ciò che permette di distinguerli già ora; **legare** una view a un pannello
  fisso è l'altra metà, e arriva con le istanze di view.

### La regola dello span: coordinate del sorgente che il kernel conosce

`Selection { span: Option<Span>, text: String }` porta il **testo** sempre, lo
**span** solo quando le sue coordinate valgono anche per il sorgente che il
kernel ha in mano — cioè a buffer pulito. Non è prudenza: è l'unico modo di
rendere impossibile l'errore che il contratto altrimenti inviterebbe a fare —
leggere il documento con `read_document` e ritagliarlo con offset calcolati su
un altro testo, cioè tagliare i byte sbagliati **proprio mentre l'utente
scrive**. Chi vuole il testo (contare le parole selezionate, mandarle a un
comando) lo ha sempre; chi vuole la posizione la ha quando è vera.

La stessa invariante è tenuta dal kernel dall'altro lato: quando il sorgente
sotto la selezione cambia, viene rinominato o sparisce, la selezione **cade**
(`Workspace::invalidate_context`). Uno span stantio è peggio di uno span
assente. La shell ne ripubblica uno vero al salvataggio successivo, che è il
momento in cui torna a essere vero.

### Chi si ridisegna, e quando

`ViewSpec` dichiara due maschere, non una: `refresh: EventMask` per gli eventi
del **vault**, `follows: ContextMask` per le parti del contesto di **sessione**
(documento, selezione, modalità). Il contesto non passa dall'event bus di
proposito: un cursore che si muove non è un fatto del vault, e farlo passare di
là significherebbe consegnare ogni battuta di tasto a ogni handler registrato.

`Workspace::set_active_context` restituisce **gli id delle view da
ridisegnare** — quelle la cui `follows` interseca ciò che è cambiato. Il conto
sta nel kernel e non nella shell perché la risposta non deve dipendere da chi
la calcola: a M5 un host diverso avrà la stessa regola. La shell resta padrona
del *quando* (è lei a pubblicare) e ignara del *chi*.

Il giro completo di una view passa quindi tutto dal contratto: la shell pubblica
il contesto → chiama `render_view` sulle view che il kernel le indica → il
provider chiede contesto e dati all'host → un click torna come `on_action` e il
provider risponde con un `ViewUpdate` (`Navigate` per i backlink), che la shell
esegue. Le prove end-to-end attraverso il kernel vero sono
`crates/fubmd-features/tests/backlinks_view_e2e.rs` (il giro base),
`outline_view_e2e.rs` (il cursore che arriva alla view) e `stats_view_e2e.rs`
(il testo selezionato che vale anche a buffer sporco).

## Import ed export: il confine è di byte, non di path (deciso)

Il capitolo 17 di FEATURES (~120 voci) è, in ogni altra applicazione, quello che
il filesystem lo tocca più di tutti: aprire uno zip, leggere una cartella,
scrivere un sito statico. Qui **nessuna delle due firme nomina un percorso**:

- `ImportProvider::import(source, request, host)` riceve
  `ImportSource { name, media_type, bytes }` — la sorgente **già letta**. Il
  `name` è quello che l'utente conosce (`vault.zip`), non un path: viene da
  fuori, e `ImportSource::stem()` lo riduce a un componente solo perché
  `../../.ssh/config.md` non diventi una scrittura fuori dal vault.
- `ExportProvider::export(request, host)` restituisce
  `ExportArtifact { path, media_type, bytes }`, dove `path` è il posto **dentro
  l'esito** (un albero relativo), non sul disco.

Chi apre il dialogo di sistema e chi posa i byte è **l'host**, che è già l'unico
a sapere dove sia il vault. La conseguenza è che import ed export non chiedono
nessuna capacità nuova all'`HostApi` oltre a `free_name` (la convenzione dei nomi
sui conflitti), e che a M5 la sandbox **non deve concedere niente**: la riga
"Filesystem: nessun accesso diretto" resta vera senza eccezioni.

Il prezzo è dichiarato: sorgente e artefatti stanno in memoria. Un export di
vault enorme è lavoro lungo, e il lavoro lungo non vede ancora il vault (§1.21
del piano); ma la firma non lo preclude — uno `stream` al confine è additivo, un
`path: string` sarebbe stato una porta aperta da richiudere con una major.

**Il recinto, dove sta.** `KernelHost::read_document`/`write_document` validano
il `DocId` con la stessa regola dei comandi IPC (`valid_doc_id`) e rispondono
`PermissionDenied` a una risalita — lo stesso errore di `data_*`. Il controllo
sta sul confine delle capacità e non dentro i provider: `ImportSource::stem()`
serve a non finirci contro per distrazione, il recinto serve perché non ci si
possa andare apposta (`fubmd-kernel/tests/transfer_dispatch.rs`).

## Lavoro lungo: i job (deciso)

I trait sono sincroni e il `Workspace` vive dietro un lock: **qualunque cosa
lenta dentro una chiamata sincrona blocca l'app**, e a M5 la deadline la
tronca. Il contratto quindi dà al lavoro lungo (rete, calcolo pesante) una
strada propria — i **job** — invece di fingere che non esista:

1. **Richiesta (sincrona, istantanea).** Durante una chiamata normale il
   plugin chiama `HostApi::spawn_job(JobSpec { job, payload })` e riceve
   subito un `JobId`. Il kernel accoda soltanto: niente esecuzione dentro al
   lock (`Workspace::take_pending_jobs`).
2. **Esecuzione (fuori dal kernel).** Chi possiede i thread — l'app oggi, il
   registry dei plugin a M4, l'host WASM a M5 — drena la coda ed esegue
   `Plugin::run_job(job, payload)` **fuori** dal lock del workspace. Il job è
   **puro rispetto al vault**: non ha `HostApi` — tutto l'input viaggia nel
   `payload` (chi lancia legge ciò che serve *prima*, nel giro sincrono),
   l'output nel risultato. Niente snapshot da invalidare, niente rientranza.
3. **Rientro (sincrono).** L'esito torna con `Workspace::complete_job` →
   `Event::JobDone { id, job, result }` sul giro sincrono normale. Il
   lanciatore riconosce il proprio `JobId` e — solo qui — scrive documenti,
   emette eventi, aggiorna storage.

Conseguenze:

- il giro sincrono resta **breve per definizione**: la deadline di M5 può
  essere severa senza uccidere i plugin legittimi;
- il permesso `network` si applica **al job** (a M5 l'istanza che esegue
  `run_job` è un componente con le stesse capability del plugin);
- un job lento o ostile non congela nulla: al peggio il suo `JobDone` porta
  un errore (timeout dell'host);
- lo **streaming** (progressi incrementali di un job) non è ancora nel
  contratto: se servirà (AI, indicizzazioni lunghe) si aggiungerà un canale di
  progresso *prima* del freeze — vedi [../appendix/ai-autocomplete.md](../appendix/ai-autocomplete.md).

## Onestà sul modello di minaccia: nativo = fidato

L'enforcement in `HostApi` confina davvero **solo chi non può aggirarlo**: un
plugin nativo è codice Rust in-process e può fare qualunque cosa, permessi o no.
Quindi, esplicitamente:

- **"plugin nativo" significa codice fidato** — feature ufficiali e plugin
  compilati dentro l'app. Il loro manifest/permessi è *descrittivo* (dogfooding
  del percorso di attivazione, UI di consenso), non una barriera di sicurezza;
- il **confine di fiducia reale esiste solo a M5**, con la sandbox WASM: è lì
  che i permessi diventano enforcement e non convenzione;
- lo scopo del primo plugin nativo (M4) è esercitare *il percorso* (manifest →
  consenso → `HostApi` con permessi → attivazione), così M5 cambia il backend,
  non inventa il confine.

Stesso principio per la UI: un provider non fidato non può emettere
`UiNode::Html`/`WebView` (iniettano contenuto attivo nella webview privilegiata
del core, scavalcando la sandbox). L'host lo rifiuta con
`UiNode::validate_untrusted()`, in un punto solo — `Workspace::render_view` /
`view_action`, dove ogni albero entra e dove ogni provider ha dichiarato il
proprio `Trust`. Vedi [ui-protocol.md](ui-protocol.md).

## Manifest e permessi (stato attuale)

```rust
pub struct PluginManifest { pub id, pub name, pub version, pub permissions: PluginPermissions }
pub struct PluginPermissions { pub read_vault: bool, pub write_vault: bool, pub network: bool }
```

## Modello capability: **ibrido** (deciso)

Il modello scelto è **grana grossa (booleani) + allowlist opzionale di path/glob**
per lo scope del vault. Non grana fine con prompt di consenso runtime (troppo costo
host/UI per il valore), non solo booleani (troppo poco per limitare *dove* un
plugin legge/scrive).

- **Concessione all'installazione:** i tre booleani (`read_vault`, `write_vault`,
  `network`) sono mostrati e accettati quando il plugin viene installato/attivato.
- **Scope opzionale del vault:** un plugin può dichiarare un'**allowlist di
  path/glob** (es. `Templates/**`, `Daily/**`); se presente, `HostApi.read_document`
  / `write_document` la applicano e negano (`PluginError::PermissionDenied`) tutto
  ciò che sta fuori. Se assente, valgono i booleani sull'intero vault.
- **Enforcement in un solo punto:** i controlli vivono nell'implementazione di
  `HostApi`, così valgono identici per plugin nativi e WASM.

Estensione prevista del manifest (da introdurre a M4, congelare in WIT):

```rust
pub struct PluginPermissions {
    pub read_vault: bool,
    pub write_vault: bool,
    pub network: bool,
    pub vault_scope: Vec<String>,   // glob; vuoto = intero vault (soggetto ai bool)
}
```

`PluginError` ha già la variante `PermissionDenied(String)` per veicolare i rifiuti
al frontend/all'IPC.

## Sandbox WASM (M5)

- **Runtime:** wasmtime, **component model**; plugin come componenti
  `wasm32-wasip2`, compilati a parte con `cargo component` (vedi `plugins/README.md`).
- **Isolamento di memoria:** dato dal component model; il plugin non vede la memoria
  del core, solo i dati che gli passano attraverso le host function.
- **Rete:** negata di default; concessa solo se `network = true`. WASI networking
  abilitato selettivamente.
- **Filesystem:** nessun accesso diretto; i documenti passano da
  `read_document`/`write_document`/`list_documents`, quindi soggetti a booleani
  + `vault_scope`; i dati del plugin passano da `data_*`, dentro al suo spazio.
  **Import ed export non fanno eccezione**, ed è una proprietà della firma e non
  della buona volontà: una sorgente da importare arriva già letta
  (`ImportSource.bytes`) e un export esce come `ExportArtifact.bytes` — vedi
  "Import ed export" sotto.
- **Storage per-plugin:** deciso e implementato, vedi "Storage" sopra —
  `storage_get/set` volatile a chiave, `data_*` persistente a blob dentro
  `.fubmd-data/plugins/<id>/`.
- **Tempo:** `now_unix_millis` viene dall'host. WASI può negare l'orologio a un
  componente, e un tempo che passa dal confine è anche un tempo che i test
  possono fermare.
- **Disponibilità, non solo memoria:** i trait sono sincroni, quindi una chiamata
  a un plugin lento/ostile bloccherebbe il kernel. L'host wasmtime usa **epoch
  interruption** (deadline per chiamata) e limiti di risorse: un plugin che
  sfora viene interrotto con `PluginError::Internal`, non congela l'app. La
  deadline può essere severa perché il lavoro lento **legittimo** ha la sua
  strada: i **job** (vedi sopra), eseguiti su un'istanza separata del
  componente con una deadline propria, più lasca. La sandbox deve garantire
  disponibilità oltre che isolamento.
- **UI:** il proxy applica `UiNode::validate_untrusted()` a ogni albero
  restituito da `render_view` (vedi [ui-protocol.md](ui-protocol.md)).

## Percorso di attivazione

1. Il core legge il `PluginManifest` (nativo: dal codice; WASM: dai metadati del
   componente).
2. Mostra/richiede i permessi; costruisce un `HostApi` **con i permessi applicati**.
3. Chiama `Plugin::activate(host)`; il plugin registra i suoi provider
   (`Command`/`View`/`Index`/`EventHandler`/`Import`/`Export`) presso il
   registry del kernel.
4. Alla disattivazione, `Plugin::deactivate(host)` e deregistrazione.

Il **primo plugin nativo** (M4) esercita esattamente questo percorso senza WASM,
così M5 diventa "cambiare il backend delle host function", non "inventare il confine".

## Rischi

- **Superficie `HostApi` troppo stretta o troppo larga** — mitigato dal primo
  plugin nativo di M4 che la mette alla prova prima del freeze.
- **Costo di serializzazione al confine WASM** — accettato solo per i plugin di
  terzi; le feature ufficiali restano native (nessuna serializzazione).
- **Glob del `vault_scope`** — semantica (case, symlink, path traversal `..`) da
  fissare con test dedicati a M4.
