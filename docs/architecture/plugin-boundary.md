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

Dalla [decisione 0021](../decisions/0021-il-confine.md) l'`HostApi` è la
**somma di dieci famiglie** — al confine WIT dieci `interface` importate una per
una dal `plugin-world` — e il punto di applicazione esiste davvero: il kernel
tiene un [registro dei plugin](../../crates/fubmd-kernel/src/plugins.rs) con
manifest, permessi e grado di fiducia, e ogni host nasce dentro un
`Guard<H, P: Policy>` che nega ciò che la politica del suo plugin non concede.
Prima `PluginPermissions` esisteva nel contratto e non lo leggeva nessuno.

Ne segue la regola di montaggio: **chi registra qualcosa si dichiara prima**
(`register_plugin`). Un id non dichiarato non è un plugin creato al volo — è un
errore, e un host intestato a un id sconosciuto nega tutto dicendo perché.

- **Nativo (M4):** `HostApi` è un oggetto in-process che chiama direttamente il
  `Workspace` (già implementato: `KernelHost` in `fubmd-kernel/src/host/kernel.rs`,
  usato dal dispatch degli eventi — a coda, mai ricorsivo, vedi
  [traits.md](traits.md)). Costo ≈ zero.
- **WASM (M5):** il plugin riceve un *proxy* di `HostApi`; ogni metodo è una **host
  function** wasmtime che serializza gli argomenti, attraversa il confine, esegue
  nel core e ritorna. La firma è identica: per questo la regola d'oro impone tipi
  serializzabili.

### Storage: uno, dopo che la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ne ha tolto uno (deciso)

Un plugin ricorda in un modo solo: `data_read/write/remove/list`, path → blob di
byte, persistente.

Ce n'erano **due**. `storage_get/set` — chiave → JSON, volatile, "per le
preferenze e i cursori" — è stato tolto dal contratto con la [decisione 0013](../decisions/0013-elenco-delle-capacita.md), ritagliando la
linea di base (`wit/frozen/0.1.0.wit`), che è la sola rottura di quel giro. La
ragione, per esteso nella [decisione 0013](../decisions/0013-elenco-delle-capacita.md): con `data_*` da una parte e le
impostazioni del §11.1 dall'altra, allo store volatile non restava un caso d'uso
— e il caso che sembrava suo, "ricordare qualcosa per la durata della sessione",
il chiamante lo aveva già risolto senza saperlo. Un provider è un **oggetto
vivo** nel workspace (`handle` prende `&mut self`), e a M5 un componente WASM ha
la propria memoria lineare: una capacità che l'host fornisce per qualcosa che il
chiamante possiede già è superficie da mantenere, da documentare e da sandboxare
per sempre. Il primo cliente vero a dimostrarlo è stato un test del kernel, dove
un handler usava una chiave dello storage come flag "l'ho già fatto": adesso è
un campo, ed è più corto.

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

### Operazioni strutturali e composizione (deciso, [decisione 0013](../decisions/0013-elenco-delle-capacita.md))

Sette capacità aggiunte prima del freeze, e la chiusura dell'elenco: dalla [decisione 0013](../decisions/0013-elenco-delle-capacita.md) la
superficie dell'`HostApi` è dichiarata **completa**, e ciò che non c'è è fuori
per una ragione scritta ([decisione 0013](../decisions/0013-elenco-delle-capacita.md), capacità per capacità).

- **`create_document(id, source)`** — crea, e **rifiuta** un path occupato. È
  l'unica differenza con `write_document`, ed è tutta la ragione per cui sono
  due: un template che sbaglia la data e usa `write_document` cancella una nota
  vera, e nel codice non sembra una cancellazione. Chi vuole comunque un nome
  libero compone con `free_name`.
- **`rename_document(from, to)`** — quella del kernel: identità preservata **e
  wikilink entranti riscritti**. Non ce n'è una versione "nuda": due semantiche
  sotto lo stesso nome sarebbero una trappola, e la nuda produce un vault che
  nessuno ha chiesto. Ne segue che è un lotto ([decisione 0011](../decisions/0011-il-lotto.md)), e dentro un lotto aperto
  vi si unisce.
- **`trash_document(id) -> DocId`**, **`list_trash()`**,
  **`restore_document(entry, to)`**, **`empty_trash() -> u64`** — il giro del
  cestino. `trash_` e non `delete_` perché non distrugge: restituisce l'id con
  cui si ripristina, e l'unica capacità che distrugge si chiama `empty_trash`.
  `list_trash` sta qui accanto a `list_documents` e **non** in `IndexQuery`: il
  cestino non è indicizzato — una nota cestinata non ha modello, né tag, né
  archi — e chiederlo al canale dati significherebbe promettere che quel canale
  sappia rispondere su ciò che non ha letto.
- **`run_command(command, args) -> CommandOutcome`** — invoca un comando del
  registro ([decisione 0009](../decisions/0009-registro-dei-comandi.md)). Non prende un `InvokeMode` (il modo è dell'host: chi si sta
  simulando invoca in simulazione e riceve il *piano*, e il piano di una macro è
  l'unione dei piani dei suoi passi), non prende un `Actor` (l'attore è chi è
  *entrato* nel kernel e resta lui per tutta la catena), non apre un lotto suo.
  Un comando non può invocare sé stesso nemmeno per giro: la catena è nota
  all'host e il rifiuto nomina il ciclo.

`run_command` è anche la ragione per cui i `CommandProvider` sono gli unici
provider **condivisi** (`Arc`) invece che estratti dal workspace per la durata
della chiamata: un comando che invoca deve trovare gli altri comandi, compresi
quelli del proprio provider.

**Dove sta il permesso.** `PluginPermissions` porta `fubmd:write-vault` e **non lo
legge nessuno** — non per dimenticanza: questo kernel non ha plugin, ha provider
registrati per id, e `Plugin::manifest()` non viene mai chiamata perché non c'è
niente che installi, abiliti o verifichi. Applicare `write_vault` oggi vorrebbe
dire inventare il registro che tiene i manifest, cioè il §7.3 e M5. Il varco
però esiste già, ed è quello della [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md): un comando in **sola lettura** o
**simulato** riceve un host che nega *tutte* e sei le strutturali con un errore
che dice perché (`crates/fubmd-kernel/tests/invoke_command.rs`,
`every_structural_capability_is_refused_by_the_same_gate`). Il giorno che
`write_vault` diventerà vincolante non dovrà costruire il rifiuto: dovrà
aggiungere una seconda ragione per negare.

### Interrogazione e contesto (deciso)

Due capacità dell'`HostApi`, aggiunte prima del freeze perché senza di esse un
`ViewProvider` non è un provider ma un guscio che l'app riempie di dati già
pronti — un dogfooding finto. Le ha chieste, come per lo storage, il primo caso
reale: il pannello backlink migrato a view (`fubmd_features::BacklinksView`).

- **`query_index(&self, IndexQuery) -> Result<IndexResult, PluginError>`** — la
  view interroga il vault da sé invece di ricevere i dati già pronti. È la
  stessa porta di `Workspace::query_index` e lo stesso dispatch: chi serve cosa è
  **dichiarato alla registrazione** ([decisione 0019](../decisions/0019-il-canale-dati.md)),
  e le risposte di cui il kernel è l'unica fonte di verità — backlink e vicini
  dal grafo, outline, tag e faccette dai metadati in cache, la salute del vault da
  entrambi — le serve `CoreIndex`, che è un `IndexProvider` registrato per primo
  e non un ramo privilegiato. È il **canale metadata**: senza, una view non potrebbe
  leggere né la struttura parsata né il frontmatter, perché non ha un
  `FormatProvider` con cui parsare — e resta il canale di ciò che il kernel
  tiene **in cache**, che è il motivo per cui una view lo usa a ogni ridisegno
  senza toccare il disco (il corpo del documento non passa di qui: sta in
  `read_model`, qui sotto). È `&self`: una query non muta, e così
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

### La struttura, e di che formato è (deciso, [decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md))

Due capacità che stanno accanto a `read_document` e non dentro `query_index`,
perché sono una **lettura del vault** e non qualcosa di derivato:

- **`read_model(&self, id) -> Result<DocumentModel, PluginError>`** — la
  struttura, con gli `Span`. È il verso che mancava: uno c'era ed è
  `IndexProvider::on_document_indexed`, **spinto**, a chi indicizza, quando lo
  decide il kernel. Tagliato fuori era il percorso **one-shot** — chi vuole il
  modello di *questa* nota *adesso*: un comando che spunta il task sotto il
  cursore, un `ExportProvider` su un documento solo, un linter su richiesta.
  **Rilegge e riparsa dal disco a ogni chiamata**, e sta nella firma: la cache
  del kernel tiene i soli metadati, quindi un modello servito dalla cache sarebbe
  una cache che non esiste. Il modello è quello del **file** — un buffer non
  salvato non lo conosce nessuno al di qua del confine — ed è la stessa regola
  dello span qui sotto, vista dall'altro lato.
- **`format_of(&self, id) -> Option<DocumentFormat>`** — chi tratterebbe quel
  documento e che sintassi capirebbe, **senza aprirlo**: è una domanda sul nome,
  risolta sull'estensione. `None` = nessun provider lo rivendica, ed è così che
  chi cammina una lista sa cosa ignorare invece di dedurlo da un errore. Vale
  anche per un documento che non esiste ancora.

Il recinto: `read_model` lo applica come `read_document` (stesso
`valid_doc_id`, stesso `PermissionDenied` a una risalita); `format_of` no, e non
perché sia meno controllato — non legge niente, e l'estensione di un path che non
nomina un documento è una domanda senza risposta, non un varco.

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
(`Session::invalidate`, in `kernel/src/session.rs`). Uno span stantio è peggio di uno span
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

## Il lotto e l'origine: N scritture come una cosa sola, e chi le ha chieste (deciso)

Un `EventHandler` non riceve un `Event` nudo ma un
**`Notice { event, origin }`**, e `Origin { actor, batch }` risponde alle due
domande che il confine non sapeva porre.

**Chi ha chiesto** — `Actor { User, Watcher, Kernel, Plugin { id } }`. È *chi ha
chiesto*, non chi ha eseguito: un comando invocato da un'automazione scrive con
l'origine dell'automazione. È l'unica lettura per cui il campo esiste, e la
difficoltà che risolve è concreta: un'automazione su-modifica **che scrive** si
richiama da sola, e prima di questo campo l'unica difesa era il budget del
dispatch, che tronca — cioè una rete di sicurezza al posto di una semantica. La
forma di quella difesa è una riga:

```rust
fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
    if notice.origin.actor.is_plugin(MIO_ID) {
        return Ok(()); // questa l'ho scritta io
    }
    // …
}
```

Riconoscerle dal **contenuto** non è equivalente e non è un ripiego accettabile:
funziona finché la scrittura cambia il proprio innesco, e smette di funzionare
proprio nel caso normale di un'automazione che appende (un diario, un log, un
sommario) — dove ogni scrittura è diversa dalla precedente e nessuna guardia di
contenuto la ferma.

**Di quale lotto fa parte** — `batch: Option<BatchId>` ([decisione 0011](../decisions/0011-il-lotto.md)). Un lotto è uno
scope del kernel dentro cui N scritture sono *una* cosa: il caso vero è una
rinomina con 200 backlink, che riscrive 200 sorgenti. Dentro un lotto:

- `IndexUpdated` **non viene emesso**, e al suo posto la chiusura emette un
  `BatchEnded { batch, changed }` con l'elenco dei documenti toccati. È l'unico
  evento coalizzato, perché è l'unico senza payload — N copie dicono quanto ne
  dice una. Gli eventi **per-documento passano tutti**: chi li segue non deve
  cambiare una riga.
- il **dispatch è rimandato** alla chiusura, come dentro la chiamata a un
  provider: a metà di un'operazione il vault è in uno stato che non è mai
  esistito per nessuno.

La regola che ne segue, ed è l'unico punto in cui la voce non è additiva: *chi
dichiara `IndexUpdated` in `ViewSpec.refresh` deve dichiarare anche
`BatchEnded`*. `EventMask::misses_batches()` la verifica, ed è la stessa funzione
che chiama il test sulle view ufficiali — non una seconda idea della regola.

**Un plugin non apre un lotto**, e non è parsimonia: uno scope a chiusura
garantita non attraversa il confine dei componenti, e un lotto lasciato aperto da
un'istanza morta terrebbe sospesi gli eventi del vault per sempre. Il lotto di un
plugin è la sua **invocazione di comando**, che l'host apre e chiude per lui — che
è anche la risposta giusta nel merito.

**Un lotto non è una transazione.** Non annulla niente, e il nome lo dice: se una
scrittura fallisce le altre restano fatte, e chi lo ha aperto lo scopre dal
proprio valore di ritorno. Il tutto-o-niente vuole il journal del §15.2, e
prometterlo con un nome (`transaction`, `rollback`) significherebbe farlo credere
a chi legge solo la firma.

Prove: `crates/fubmd-kernel/tests/batch_and_origin.rs` (incluso il confronto fra
un'automazione che si difende con l'origine e la stessa che non lo fa),
`crates/fubmd-features/tests/{commands_e2e,view_refresh_masks}.rs`.

## Scrivere un pezzo: l'edit porta la revisione (deciso)

Un plugin ha due modi di cambiare un documento, e la differenza sta nella firma:

| | `write_document(id, source)` | `apply_edit(id, request)` |
|---|---|---|
| Cosa manda | il documento **intero** | una lista di `(span, testo)` |
| Su cosa si applica | su qualunque cosa ci sia adesso | sul sorgente che `request.base` nomina |
| Chi ha scritto nel frattempo | viene sovrascritto **in silenzio** | fa fallire la richiesta (`Conflict`), niente scritto |
| Chi lo usa | chi il testo intero ce l'ha in mano: l'editor che salva, un importer che crea | tutti gli altri |

`EditRequest { base: Revision, edits: Vec<TextEdit> }`. La base **non è
opzionale**: un edit è una coppia di offset calcolata su *un* testo, e senza
dire quale, due modifiche concorrenti — un'automazione e l'utente che scrive —
si cancellano a vicenda senza che nessuna delle due lo sappia. Con la base, la
seconda riceve `PluginError::Conflict`, rilegge e ricalcola.

La `Revision` è **opaca**: solo l'uguaglianza è contratto. Non è un numero
d'ordine, non ci si legge dentro, e come l'host la derivi (impronta del
contenuto, digest, `mtime+size`) non è promesso a nessuno — la si chiede con
`document_revision`. Questo host usa l'impronta del contenuto, e la scelta si
vede in un caso vero: chi scrive un carattere e lo cancella riporta il documento
al testo di prima, e un edit calcolato allora è ancora valido; un contatore
direbbe di no.

Gli span della richiesta sono in byte del sorgente della base — mai del testo in
corso di produzione: chi calcola gli edit li elenca e basta, l'host li ordina e
li applica in un colpo solo. Ciò che non sta in piedi (fuori dal sorgente, a
metà di un carattere, sovrapposti, due nello stesso punto) è `BadArgs`, e non
lascia mai un documento modificato a metà.

Il rapporto (`EditReport { revision, applied }`) torna nelle coordinate del
testo **nuovo** e porta ciò che è stato sostituito: con quei due pezzi si mette
il cursore dove l'utente se lo aspetta (16.1) e si costruisce l'edit **inverso**,
che è un edit come gli altri (`EditReport::inverse`). Di chi sia la proprietà
dell'undo resta una domanda aperta (§13.3 del piano); la forma con cui si
esprimerà è questa.

Il primo cliente è il kernel stesso: la riscrittura dei wikilink su rename
(`Workspace::rename_document`) applica ora un `EditRequest` per sorgente invece
di riscrivere N file interi — quindi una nota che qualcun altro ha toccato fra
il calcolo del piano e la sua applicazione non viene più sovrascritta, e il
fallimento si nomina.

## Invocare un comando: cosa l'host fa rispettare (deciso)

Il registro dei comandi ([decisione 0009](../decisions/0009-registro-dei-comandi.md)) è il posto in cui un'azione si dichiara **una
volta** e la chiedono tutti: la palette, la tastiera, una macro (16.2), la CLI
(27.1), l'API locale (27.2), il centro di comando LLM (22.4). Da qui in poi una
feature nuova non aggiunge un comando Tauri: aggiunge una riga a un
`CommandProvider`, e la shell la trova da sola.

La parte che riguarda questo documento non è il registro, è cosa il confine
**garantisce** a chi invoca senza aver letto il codice del comando:

| Chi invoca dichiara | Chi implementa dichiara | Cosa gli presta l'host |
|---|---|---|
| `InvokeMode::Apply` | `scope.writes: true` | `KernelHost`: scrive |
| `InvokeMode::Apply` | `scope.writes: false` | host in **sola lettura**: ogni scrittura è `PermissionDenied` |
| `InvokeMode::DryRun` | qualunque cosa | host in **sola lettura** |

Due conseguenze, ed è per esse che la tabella esiste:

- **La simulazione è un modo di invocare, non una cortesia di chi implementa.**
  Un dry-run che dipendesse dalla buona volontà del comando sarebbe una
  convenzione — cioè qualcosa che un comando di terzi non onora, e proprio nel
  momento in cui il chiamante si fida di lui (l'anteprima prima di toccare 40
  note).
- **Dichiararsi innocuo è vincolante.** `writes: false` non è una decorazione da
  mostrare nella palette: chi lo dichiara riceve un host che rifiuta, e se ci
  prova fallisce nei propri test.

Gli **argomenti** sono l'altra metà: l'host li convalida contro la
`CommandSpec` prima di chiamare (`validate_args`), quindi un comando non si
difende da solo e chi sbaglia riceve un `BadArgs` che dice *cosa* manca. Un
argomento non dichiarato è un errore e non un argomento ignorato: per un
chiamante che non può leggere il codice, «ho chiesto una cosa, ne è successa
un'altra, e non me ne accorgo» è il peggiore dei fallimenti.

**Chi invoca dice anche chi è**, e l'host apre un lotto:
`invoke_command(command, args, mode, by: Actor)`. Un `Apply` è per definizione
*una* cosa che qualcuno ha chiesto, quindi `vault.replace` su 40 note emette un
`batch-ended` solo, e ogni evento che ne nasce porta `by` come attore. Il
parametro non ha un default per la stessa ragione per cui non ce l'ha
`InvokeMode`: attribuire all'utente ciò che ha chiesto un'automazione le
toglierebbe l'unica difesa che ha contro il richiamarsi da sola. Sul confine
Tauri l'attore è fissato a `User` invece di essere un parametro dell'IPC — da lì
passa la webview, e un chiamante che potesse firmarsi come vuole avrebbe aggirato
quella difesa dall'altra parte.

`by` **non** arriva fino a `CommandProvider::invoke`: l'origine è ciò che l'host
appone, non ciò che il comando legge. Un comando che si comportasse diversamente
a seconda di chi lo chiama sarebbe una policy nascosta in un'implementazione, e
le policy hanno un posto (§7.3). Il giorno che servirà **leggerla**, è un metodo
additivo sull'`HostApi`, non una firma da riaprire.

### Il consenso non è una capacità

`PluginPermissions` (§7.3, qui sotto) risponde a «questo componente *può*, in
generale?». 22.4 chiede un'altra cosa: «l'utente approva **questa** esecuzione,
su **queste** 40 note?». La risposta di FubMD è il giro **dry-run → piano →
approvazione → apply**, e non una capacità `HostApi::confirm`. Due ragioni:

1. **Un host non può fermarsi a chiedere.** Il kernel è chiamato *dalla* shell e
   ne tiene il lock: una conferma sincrona dovrebbe risalire nella webview che
   sta aspettando la risposta. Una capacità che questo host non può implementare
   sarebbe una firma che ogni host dovrà onorare e nessuno onora.
2. **Il piano si legge, la domanda no.** Una conferma nel mezzo mostra ciò che il
   comando *sceglie* di dire; un `CommandPlan` mostra i documenti impattati e gli
   edit proposti, e li mostra prima. È la differenza fra «sei sicuro?» e il diff.

*Quando* chiedere lo decide chi invoca, e lo decide dal `CommandScope`
dichiarato: la shell mostra il piano quando un comando scrive su più di una nota
o si dichiara non reversibile (`needsPlan` in `frontend/src/ui/palette.ts`). Una CLI
in uno script può avere un'altra politica sullo stesso dato — è per questo che il
raggio sta nella spec e la politica no.

Resta fuori, dichiarato: l'**attribuzione** (chi ha chiesto l'operazione: utente,
comando, modello, prompt) è l'origine degli eventi ([decisione 0012](../decisions/0012-origine-degli-eventi.md)) applicata al lotto
([decisione 0011](../decisions/0011-il-lotto.md)), e senza quelle due un campo qui sarebbe scritto da chi invoca e letto da
nessuno.

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
vault enorme è lavoro lungo, e dalla
[decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md) il lavoro
lungo il vault lo vede; ma la firma non preclude niente di più — uno `stream` al confine è additivo, un
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
   `Plugin::run_job(job, payload, host)` **fuori** dal giro sincrono del kernel,
   **senza tenere in mano nessun prestito del workspace**. Il job ha le stesse
   capacità che il plugin ha altrove ([decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md)),
   con davanti la politica dei suoi permessi, e le usa **una chiamata alla
   volta**: ogni capacità prende il prestito, fa il suo lavoro e lo rilascia. Il
   `payload` porta gli **argomenti**, non l'input.
3. **Rientro (sincrono).** L'esito torna con `Workspace::complete_job` →
   `Event::JobDone { id, job, result }` sul giro sincrono normale. Il
   lanciatore riconosce il proprio `JobId` e legge il **risultato** — che non è
   più il solo effetto che un job poteva avere.

Conseguenze:

- il giro sincrono resta **breve per definizione**: la deadline di M5 può
  essere severa senza uccidere i plugin legittimi;
- **niente snapshot**: fra due chiamate il vault può cambiare, e chi lo cammina
  vedrà qualcosa che non è mai stato vero tutto insieme. La guardia contro quel
  cambio è quella di tutti — `apply_edit` con la sua `base` e `Conflict`
  ([decisione 0008](../decisions/0008-modifica-chirurgica.md)), `create_document`
  che rifiuta un path occupato — e un job non è né una transazione né un lotto;
- **al confine WIT non si vede**, ed è la ragione per cui il divieto di prima non
  era sostenibile: le capacità sono import del world, non un parametro di
  `run-job`, quindi «dentro un job non c'è `host-api`» era una regola solo Rust;
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
pub struct PluginManifest { pub id, pub name, pub version, pub abi_version, pub permissions: PluginPermissions }
pub struct PluginPermissions { pub granted: OptionMap }   // `ns:nome` → parametro
```

Erano **tre booleani** fino alla
[decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md), ed è
la forma che è cambiata, non la larghezza: un booleano non ha dove mettere il
**parametro** di un permesso, e «rete» senza allowlist è o tutto o niente —
mentre 20.3 chiede proprio l'allowlist, di rete e di file. Le chiavi del core
stanno in `options::permission`; un permesso con un namespace di terzi attraversa
il confine intatto, e un host che non lo conosce può **rifiutarlo** — che è
esattamente ciò che un enum chiuso non gli avrebbe permesso di fare.

## Modello capability: **ibrido** (deciso)

Il modello scelto è **grana grossa (un permesso per capacità) + allowlist come
parametro del permesso**. Non grana fine con prompt di consenso runtime (troppo
costo host/UI per il valore), non permessi nudi (troppo poco per limitare *dove*
un plugin legge, scrive o si connette).

L'allowlist non è più un campo a parte: è il **valore** della voce, ed è la
ragione per cui i tre booleani sono diventati una mappa.

- **Concessione all'installazione:** le voci di `granted` sono mostrate e
  accettate quando il plugin viene installato/attivato.
- **Scope del vault:** `fubmd:read-vault` / `fubmd:write-vault` con un elenco di
  prefissi (es. `["Templates/", "Daily/"]`); `HostApi.read_document` /
  `write_document` lo applicano e negano (`PluginError::PermissionDenied`) tutto
  ciò che sta fuori. Senza parametro, la voce vale sull'intero vault. Sotto
  `read-vault` ci va anche `read_model`, che è una lettura come l'altra e dà **di
  più** di una sorgente; `format_of` no, perché non legge niente — dice solo chi
  tratterebbe un nome.
- **Rete e filesystem esterno:** `fubmd:network` con l'allowlist di host,
  `fubmd:external-fs` con quella dei path (20.3).
- **Enforcement in un solo punto:** i controlli vivono nell'implementazione di
  `HostApi`, così valgono identici per plugin nativi e WASM. **Quel punto non
  esiste ancora**, ed è il §7.3: la 0017 ha fissato la forma, che è la metà che
  scade col freeze.

```rust
PluginPermissions::of(&[permission::READ_VAULT])          // tutto il vault, in lettura
    .granted
    .with(permission::NETWORK, json!(["api.esempio.com"])) // rete, con allowlist
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
  `read_document`/`read_model`/`write_document`/`list_documents`, quindi soggetti
  a booleani + `vault_scope`; i dati del plugin passano da `data_*`, dentro al suo spazio.
  **Import ed export non fanno eccezione**, ed è una proprietà della firma e non
  della buona volontà: una sorgente da importare arriva già letta
  (`ImportSource.bytes`) e un export esce come `ExportArtifact.bytes` — vedi
  "Import ed export" sotto.
- **Storage per-plugin:** deciso e implementato, vedi "Storage" sopra — `data_*`
  a blob dentro `.fubmd-data/plugins/<id>/`, e nient'altro.
- **Operazioni strutturali:** `create_document`, `rename_document`,
  `trash_document`, `list_trash`, `restore_document`, `empty_trash` — vedi
  "Operazioni strutturali" sopra. Sono ciò che `write_vault` dovrà governare.
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
