# M4 — Hardening del contratto + WIT

Torna a [../PIANO.md](../PIANO.md) · segue [M3](M3-editor-fidelity.md) · precede
[M5](M5-wasm-runtime.md).

## Obiettivo

**Congelare** la superficie dei trait di `fubmd-abi` e certificarla esprimibile in
WIT, così che il runtime WASM di [M5](M5-wasm-runtime.md) sia un lavoro *meccanico*
e non una rincorsa a firme non serializzabili. Provare l'intero confine con un
**primo plugin nativo** che usa `Plugin`/`HostApi`.

## Contesto: il `wit/` è già vivo da M2

Decisione presa: `wit/fubmd/*.wit` **non** nasce a M4 — è mantenuto vivo fin da M2,
con un test di conformità abi↔WIT che gira ad ogni commit. Così la "regola d'oro"
(vedi [../architecture/traits.md](../architecture/traits.md)) è verificata in
continuazione, non asserita. M4 è il punto in cui quel WIT viene **congelato** e
promosso a contratto stabile.

Stato repo: la cartella `wit/fubmd/` esiste già (vuota); `plugins/README.md` prevede
componenti `wasm32-wasip2` compilati con `cargo component`.

## Design

### Freeze della superficie dei trait

- Revisione finale dei 7 trait e di tutti i tipi che ne attraversano le firme
  (tabella di esprimibilità in [../architecture/traits.md](../architecture/traits.md)).
- Da qui: **cambi additivi versionati**; le modifiche breaking richiedono un bump di
  versione del contratto. Documentare la policy di compatibilità.
- Consolidare le estensioni introdotte in corso d'opera: lo **scope del vault**
  nei permessi — che dalla [decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)
  non è più un campo da aggiungere ma il *parametro* della voce
  `fubmd:read-vault` / `fubmd:write-vault` (vedi
  [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md)), i
  nodi input di `UiNode` aggiunti a [M3](M3-editor-fidelity.md), e il modello dei
  **job** (`JobSpec`/`JobId`, `spawn_job`/`run_job`, `Event::JobDone`/`Overflow`)
  già nel contratto e nel `wit/` da M2. Prima del freeze va deciso se ai job
  serve un canale di **progresso** (streaming) o se `JobDone` basta.

### `wit/fubmd/*.wit` che rispecchia `fubmd-abi`

- File WIT organizzati per area: `model`, `format`, `ui`, `index`, `events`,
  `command`, `plugin`, `host-api`.
- Mapping secondo la tabella in [traits.md](../architecture/traits.md): record,
  variant, enum, `list<..>`, `result<_, error>`; i valori JSON liberi (`attrs`,
  `args`, storage) come `type json = string`.
- Il component world del plugin (import: `host-api`; export: i provider
  implementati) è definito qui.

### Test di conformità abi↔WIT

**È fatta** (vedi [wit/README.md](../../wit/README.md), e
[wit/frozen/README.md](../../wit/frozen/README.md) per la gemella che confronta
il contratto con com'era): il test parsa `abi.wit` con `wit-parser` e
confronta nelle due direzioni — contratto morto incluso — **nomi e tipi**: campi
dei record in ordine, payload dei casi di variant, destinazioni degli alias,
firme complete delle funzioni, ed elisione di `host`. I tipi attesi non sono
scritti a mano: si deducono dai tipi Rust (`wit(&campo)` sul campo destrutturato,
`WitFn` sul puntatore a funzione, che è un cast del metodo del trait), quindi una
divergenza di forma **non compila** — la proprietà che si voleva da `wit-bindgen`
+ `From`/`Into`, senza generare codice. Ha il proprio test del test (quattordici
mutazioni) e gira in CI.

Resta a M4, sulla conformità:

- rivalutare se i valori JSON liberi (`attrs`, `args`, storage) restano
  `type json = string` al freeze (vedi "Punto di attenzione noto" in
  [traits.md](../architecture/traits.md));
- il tooling continua a vivere al confine, **mai** fra le dipendenze normali di
  `fubmd-abi`/`fubmd-kernel` (`wit-parser` è una dev-dependency, che l'invariante
  non tocca).

### Primo plugin nativo (`Plugin`/`HostApi`)

- Un plugin **nativo** (non WASM) che implementa `Plugin` + almeno un provider
  (candidato: un `CommandProvider` utile, es. "inserisci data", o un `ViewProvider`
  semplice), attivato tramite il percorso di
  [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md).
- Esercita: manifest, permessi (booleani + eventuale `vault_scope`), `activate`/
  `deactivate`, registrazione presso il registry, uso di `HostApi`.
- Il registry di M4 porta anche il **runner dei job**: un pool di thread che
  drena `Workspace::take_pending_jobs`, esegue `Plugin::run_job` **senza tenere
  in mano nessun prestito** del workspace — il job ne prende uno per chiamata,
  con il `JobHost` di `fubmd-host`
  ([decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md)) — e
  riconsegna con `complete_job` (il giro `spawn_job` → `JobDone` è già
  implementato e testato nel kernel: `tests/rename_and_events.rs`). Il plugin
  nativo dovrebbe esercitare anche un job end-to-end.
- Valore: mette alla prova il confine **prima** di aggiungere WASM. Se `HostApi` è
  scomoda, si corregge qui (ultimo momento prima del freeze duro per M5).
- Un anticipo lo ha già dato il **versioning**, che è un `EventHandler` scritto
  con le sole capacità di un plugin: ha fatto emergere che l'`HostApi` non
  bastava a tenere uno store su disco né a sapere l'ora, e il contratto è stato
  allargato di conseguenza (`data_*`, `now_unix_millis`, `list_documents` —
  vedi [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md)).
  Resta da decidere **qui** la stessa domanda per `IndexProvider`, le cui firme
  non portano un host: `SearchIndex` scrive ancora con `std::fs`, e un indice di
  terzi a M5 non potrebbe.

## Checklist del freeze

Le decisioni "gratis prima, breaking dopo" sono le voci marcate **P0** in
[todo.md](../todo.md) — la marcatura vuol dire esattamente questo: forma di
contratto, quindi scadenza al freeze — e quell'elenco è l'autorevole; qui stanno
quelle che hanno una **domanda aperta** e una risposta da mettere a verbale prima
di chiudere. Le prime sono **già chiuse** in corso d'opera (il costo era una riga
oggi, una migrazione domani); le altre restano al freeze.

**Chiuse prima del freeze:**

- **Semantica di consegna eventi**: gli eventi arrivano *dopo che la chiamata
  del provider è tornata*, mai dentro il suo frame (`in_provider_call` nel
  kernel; contratto documentato su `EventHandler`). Identica a ciò che il
  proxy WASM può onorare: un plugin che è insieme view e handler non rientra
  mai nella propria istanza.
- **`abi_version` nel `PluginManifest`** + regola scritta (`abi_compatible`):
  major diversa → rifiuto; minor del plugin ≤ minor dell'host → accetto.
- **`ViewUpdate::Custom { ns, payload }`**: il varco di estensione degli
  intenti, con degrado garbato ("la shell che non riconosce non fa nulla").
  L'enum si può dichiarare chiuso al freeze: gli intenti nuovi nascono nel
  varco e vengono promossi solo se universali.
- **Discovery e invalidazione delle view**: comando `list_views`, montaggio
  per `placement`, dichiarazione di interesse `ViewSpec.refresh: EventMask`
  esercitata dalle tre feature ufficiali.
- **u64 sull'IPC JSON**: gli u64 identità/impronta attraversano il terzo
  confine come **stringhe** (`fubmd_abi::ipc`); presidiato dalle fixture dei
  mirror TS (contratto e app).
- **Il ciclo di vita di un indice**: `IndexProvider::close(host)` **senza corpo
  di default** ([decisione 0028](../decisions/0028-come-un-componente-smette.md)).
  Una funzione nuova in un'interfaccia è additiva nel WIT, quindi ciò che scadeva
  col freeze non era la voce ma la **scelta**: obbligatoria si aggiunge oggi a
  costo zero (gli implementatori si contano), dopo smetterebbe di compilare per
  ogni provider di terzi già scritto. Obbligatoria perché il caso che un default
  no-op avrebbe reso invisibile — un indice che tiene un lock file e non ha dove
  rilasciarlo — è il caso normale, e perché a M5 non c'è nessun `Drop` su cui
  ripiegare.
- **Il ciclo di vita del *vault*, che è un'altra cosa**: `event-vault-closed`
  (record + caso del `variant event`) e `vault-closed` in `event-kind`, **in
  coda a tutti e due** e quindi additivi
  ([decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)).
  È il gemello di `vault-opened`, e il suo contratto sta tutto nel *quando*:
  arriva **prima** che si spenga chiunque, mentre chi lo riceve è ancora
  registrato e può ancora scrivere. Sta qui e non fra le decisioni rimandate
  perché è la risposta a una domanda di forma: chi non è un indice — cioè ogni
  `EventHandler` — non ha un metodo di ciclo di vita e **non lo avrà**, quindi o
  la chiusura è un evento o quel caso resta scoperto per sempre. Un evento e non
  una capacità per la regola della [0013](../decisions/0013-elenco-delle-capacita.md):
  chi chiude non aspetta la risposta, e la chiusura non si annulla. `event-mask`
  è una `list<event-kind>`, quindi il tipo nuovo non tocca nessuna maschera già
  scritta.

**Da chiudere al freeze:**

- [x] **Il grafo nel contratto** — fatto con la [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md): `IndexQuery::Neighbors { doc,
      direction, depth, page }` risponde dal `LinkGraph`, e `NeighborRef` porta
      il `via` con cui si ricostruiscono gli archi oltre il primo passo. Il
      comando `graph_data` non è più superficie privilegiata: è il **primo
      cliente** della variante, e prende gli archi una nota alla volta come farà
      una vista a grafo di terzi.
- [x] **Import ed export nel contratto** — fatto con la [decisione 0006](../decisions/0006-import-export-come-trait.md):
      `ImportProvider`/`ExportProvider` in `abi/transfer.rs`, con
      `MarkdownImport`/`MarkdownExport` come **primo cliente** vero attraverso
      il kernel. La decisione che il freeze avrebbe reso definitiva è la forma
      della sorgente: **byte, non path** (`ImportSource.bytes`,
      `ExportArtifact.bytes`), che è ciò per cui il capitolo 17 non chiede
      nessuna capacità filesystem e la sandbox di M5 non deve concedere niente.
      Con essa: `ImportMode::Preview` invece di un `MigrationPlan` gemello, e
      `HostApi::free_name` — una capacità in più nell'elenco della [decisione 0013](../decisions/0013-elenco-delle-capacita.md), trovata
      da un cliente vero. Restano aperti sopra questa firma la [decisione 0011](../decisions/0011-il-lotto.md) (rollback e
      lotto) e il §9.1 (l'import come lavoro lungo). Il modello a un exporter
      **non è più aperto**: `HostApi::read_model` lo serve
      ([decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md)), e un
      export PDF/Typst non deve più riparsare.
- [x] **Modificare un pezzo di documento** — fatto con la [decisione 0008](../decisions/0008-modifica-chirurgica.md):
      `HostApi::apply_edit(id, EditRequest { base, edits })` e
      `HostApi::document_revision(id)` (interface `edit` nel WIT), con la
      riscrittura dei link su rename come **primo cliente** vero. La decisione
      che il freeze avrebbe reso definitiva è che la richiesta porta la
      **revisione su cui è stata calcolata**, e non come campo opzionale: senza,
      due modifiche concorrenti si sovrascrivono in silenzio, e aggiungerla dopo
      sarebbe una migrazione di ogni chiamante. Con essa: `PluginError::Conflict`
      come caso a sé (l'unico errore che si **riprova** invece di correggerlo) e
      un rapporto in coordinate nuove da cui l'inverso di un edit è un edit.
      Restano aperti sopra questa firma la [decisione 0011](../decisions/0011-il-lotto.md) (il lotto su più documenti), il
      §13.3 (chi possiede l'undo) e la [decisione 0012](../decisions/0012-origine-degli-eventi.md) (l'edit sull'evento, senza cui la
      shell deve ricaricare il documento invece di applicarlo al buffer).
- [x] **Operazioni strutturali e parità plugin↔nativo** — fatto con la [decisione 0013](../decisions/0013-elenco-delle-capacita.md), che ha
      **chiuso l'elenco** delle capacità: `create_document`, `rename_document`,
      `trash_document`, `list_trash`, `restore_document`, `empty_trash`,
      `run_command`; via `storage_get`/`storage_set`; ventidue metodi in tutto.
      Primo cliente vero: le cinque azioni strutturali della shell migrate a
      `CoreCommands`, con **sei comandi Tauri spariti**, più `vault.archive` che
      compone via `run_command`. Le decisioni che il freeze avrebbe reso
      definitive: il rename del contratto è quello che **riscrive i backlink**
      (non ce n'è uno nudo), `create_document` **rifiuta** un path occupato (è
      l'unica differenza con `write_document`, ed è quella che impedisce a un
      template di cancellare una nota), `list_trash` sta accanto a
      `list_documents` e non in `IndexQuery` (il cestino non è indicizzato), e
      `run_command` non prende né modo né attore né lotto — li eredita tutti e
      tre. `wit/frozen/0.1.0.wit` **ritagliato** (`storage-*` era pubblicata).
      Verbale capacità per capacità, incluse quelle che restano fuori, in
      [decisione 0013](../decisions/0013-elenco-delle-capacita.md).
- [x] **`create_note` in una cartella** — deciso col punto sopra:
      `create_document` prende un **`DocId` completo**, non un nome da cui
      l'host deriva il path. Un importer o un template sanno dove va la nota, e
      un host che scegliesse la cartella per loro renderebbe inesprimibile metà
      del capitolo 16. La nota senza titolo la costruisce il *comando*
      (`note.create` compone `free_name` + `create_document`), non il contratto.
- [ ] **Escape hatch `type json = string`**: confermare al freeze, uso per
      uso (frontmatter, `attrs`, args dei comandi e di `run-command`, payload
      dei job),
      che l'opacità è accettabile — o promuovere a record WIT tipati dove non
      lo è. Il costo di tenerla: nessun controllo di forma al confine; il
      costo di toglierla: il contratto esplode a ogni formato nuovo.
- [ ] **Canale progresso/streaming dei job**: decidere se `Event::JobDone`
      basta. Aggiungere un canale dopo è breaking; l'alternativa ponte è un
      `Event::Custom` con topic convenzionale (`<plugin>/job-progress`), che
      il varco già permette senza toccare il contratto — se basta quella, la
      decisione è "JobDone + convenzione documentata". La [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha già deciso la
      **forma**: se un canale ci sarà, sarà un **evento** e non una capacità —
      ciò che si limita a informare non è qualcosa di cui il chiamante aspetta
      la risposta. Resta da decidere se serve una variante dedicata o basta
      `Custom`.
- [x] **Contesto di una view: `active_document()` o `ViewContext`?** — **deciso
      pre-freeze**: `HostApi::active_context() -> Option<ViewContext>`, con
      `ViewContext { pane, doc, selection, mode }` (interface `session` nel
      WIT). La selezione attraversa il confine come
      `Selection { span: Option<Span>, text: String }`: il testo sempre, lo span
      solo quando le sue coordinate valgono anche per il sorgente del kernel.
      `ViewSpec` guadagna `follows: ContextMask`, o "ridisegna al cambio di nota
      attiva" diventerebbe "ridisegna a ogni battuta di tasto". Verbale in
      [decisione 0007](../decisions/0007-contesto-di-sessione.md); `wit/frozen/0.1.0.wit` **ritagliato** (la
      firma di `active-document` era pubblicata).
- [ ] **Identità del documento: il path è per sempre la chiave?**
      ([todo.md §13.1](../todo.md)) FEATURES chiede uuid opzionale (2.2), stable
      note ID e redirect da note rinominate (7.1), Zettelkasten ID (8.3), mentre
      ogni firma prende `DocId` = path. O si dichiara che il path resta la chiave
      e i redirect sono una feature sopra (tabella di alias persistente), o si
      introduce ora un `DocRef` a due forme: la seconda strada, dopo, è una major.
- [ ] **Forma dell'errore al confine** ([todo.md §12.2](../todo.md)):
      `PluginError`/`KernelError` sono nel contratto e finiscono in `String` su
      tutti i comandi IPC. Decidere se l'errore porta **codice + parametri** —
      prerequisito della localizzazione (25.2, §12.1), delle notifiche (10.5) e
      dei retry delle automazioni (16.3). Un messaggio già composto non si
      traduce e non si discrimina: la shell oggi indovina.
- [x] **Il lotto: serve una variante di evento?** — sì, fatto con la [decisione 0011](../decisions/0011-il-lotto.md) + [decisione 0012](../decisions/0012-origine-degli-eventi.md):
      `Event::BatchEnded { batch, changed }` e `EventKind::BatchEnded` (additivi,
      in coda), `Workspace::batch(|ws| …)` nel kernel, e tre clienti veri —
      `rename_document`, ogni `invoke_command(…, Apply)` e la shell. Le quattro
      domande, con la risposta a verbale:
      1. **Cosa coalizza** → solo `index-updated`, l'unico evento senza payload,
         cioè l'unico di cui N copie dicono quanto ne dice una. Gli eventi
         per-documento passano tutti, quindi nessun handler esistente deve
         cambiare. Misura sul caso vero: 201 ridisegni completi → 1.
      2. **Chi lo apre** → il kernel per sé e `invoke_command` per ogni `Apply`.
         **Non** un plugin: uno scope a chiusura garantita non attraversa il
         confine dei componenti, e un lotto lasciato aperto da un'istanza morta
         sospenderebbe gli eventi del vault per sempre. Il lotto di un plugin è
         la sua invocazione di comando.
      3. **Semantica di annullamento** → **nessuna**, e il nome lo dice (`batch`,
         non `transaction`): il tutto-o-niente vuole il journal del §15.2, e un
         annullamento che non sopravvive alla morte del processo non è un
         annullamento. Chi apre il lotto sceglie per il proprio caso, dal proprio
         valore di ritorno.
      4. **Il lotto troncato dall'`Overflow`** → nessuna garanzia in più: il
         terminale sta in coda come gli altri, e l'`Overflow` che arriva al suo
         posto chiede *di più* («riconcilia da zero») di quanto chiederebbe lui.

      Il prezzo, e l'unico punto non additivo: chi dichiarava il solo
      `index-updated` dentro un lotto non riceve più niente. Presidiato da
      `EventMask::misses_batches()` nel contratto e da un test su ogni view
      ufficiale, non da una nota nella prosa.
- [x] **L'origine degli eventi** — fatta con la [decisione 0012](../decisions/0012-origine-degli-eventi.md), ed è **l'unica rottura di una
      firma già pubblicata** di questo giro: `event-handler.handle` prendeva un
      `event` nudo e adesso prende un `notice` (evento + origine). Linea di base
      ritagliata in `wit/frozen/0.1.0.wit`, con la ragione accanto: senza
      l'origine sul parametro, un'automazione su-modifica che scrive non
      riconosce le proprie scritture e si richiama da sé finché il
      `DISPATCH_BUDGET` non tronca — cioè una rete di sicurezza al posto di una
      semantica. `Origin { actor, batch }` con
      `Actor { User, Watcher, Kernel, Plugin { id } }`, e l'attore è **chi ha
      chiesto**, non chi ha eseguito. Toccata anche
      `Workspace::invoke_command(…, by: Actor)` — che non è superficie di plugin,
      ma è l'ultimo momento in cui costa un parametro invece di una minor;
      `CommandProvider::invoke` resta com'era, perché l'origine l'host la
      **appone** e il comando non la legge.
- [x] **Canale del rendering: solo HTML, o anche il modello?** — fatto con la
      [decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md), e la
      risposta è **doppia**. Di qua dal confine il modello **si chiede**:
      `HostApi::read_model(id)` (con `format_of(id)` per sapere di che formato è
      un documento senza aprirlo). Verso il webview **no**: `render_preview`
      resta la fast-path — HTML più le parti dichiarative della
      [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) —
      perché il modello è quello del **file** e la webview lavora sul **buffer**.
      Ciò che la shell vuole *fare* col modello lo chiede come comando
      (`note.task.toggle` è il primo cliente); le coordinate del sorgente per
      scroll sync e rendering incrementale saranno una chiave di `RenderOptions`,
      non un secondo canale. Resta il §4.4 (la sintassi nuova nasce due volte),
      che è shell e P1.
- [x] **Un comando invocato da chi non ha letto il codice** — fatto con la [decisione 0009](../decisions/0009-registro-dei-comandi.md) +
      [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md): registro nel `Workspace` (`register_command_provider`, `commands`,
      `invoke_command`), `list_commands`/`invoke_command` sull'IPC, interface
      `command` riscritta nel WIT, e `CoreCommands` + la **palette** come primi
      clienti. Le tre domande, con la risposta a verbale:
      1. **Come si dichiara un parametro** → uno **schema a sé**
         (`ParamSpec { name, title, description, kind, required }`,
         `ParamKind { text, number, bool, document, documents, choice }`), non i
         nodi di input del protocollo di UI. La ragione non è che i nodi non
         basterebbero: è che
         dichiarare *cosa serve* e disegnare *come lo si chiede* sono due
         domande, e solo la prima ha senso per la CLI, per un'automazione e per
         un modello, che non disegnano niente. Quando arriveranno i nodi di
         input, saranno la **resa** di un `ParamSpec` — e ora che ci sono
         ([decisione 0016](../decisions/0016-cosa-e-una-view.md)) la promessa è
         verificabile: `ViewSpec::params` dichiara gli stessi `ParamSpec`, e la
         convalida è letteralmente la stessa funzione. E sì: `CommandSpec`
         acquista la `description` in prosa, che la palette non usa e senza cui
         un chiamante non umano sceglie a caso.
      2. **Dove vive il dry-run** → un argomento `mode: InvokeMode` su `invoke`,
         cioè la **rottura di firma fatta adesso** (linea di base ritagliata in
         `wit/frozen/0.1.0.wit`, come per la [decisione 0007](../decisions/0007-contesto-di-sessione.md)). La variante
         `CommandOutcome::Plan` da sola sarebbe stata una convenzione fra
         chiamante e comando; con il modo nella firma, l'host può *far
         rispettare* la simulazione — presta un `HostApi` in sola lettura, e un
         comando che ci prova riceve `PermissionDenied`. La stessa leva vale per
         `scope.writes`: chi si dichiara di sola lettura riceve lo stesso host,
         quindi la dichiarazione è vincolante e non decorativa.
      3. **Dove vive il consenso** → **né** in una capacità `HostApi` **né** in
         un `Confirm` sull'outcome: è il giro *dry-run → piano → approvazione →
         apply*, e a decidere quando chiederlo è **chi invoca**, sulla base del
         raggio dichiarato (`needsPlan` nella palette; una CLI può avere un'altra
         politica sullo stesso dato). Una conferma sincrona nell'host non è
         implementabile da questo host — il kernel è chiamato *dalla* shell e ne
         tiene il lock, quindi dovrebbe risalire nella webview che sta aspettando
         la risposta — e una firma che ogni host dovrà onorare e nessuno onora è
         peggio che assente. In più il piano si **legge**: mostra i `DocId`
         impattati e gli `EditRequest` proposti, mentre «sei sicuro?» mostra ciò
         che il comando sceglie di dire. Il §7.3 resta la domanda gemella e
         diversa: non «l'utente approva questa esecuzione?» ma «questo componente
         può, in generale?».
      Resta aperto sopra questa firma, dichiarato: ~~l'**attribuzione**~~
      (fatta, [decisione 0012](../decisions/0012-origine-degli-eventi.md) + [decisione 0011](../decisions/0011-il-lotto.md)), le **impostazioni scrivibili da un programma**
      (§11.1: il vocabolario c'è, `CommandReach::Settings`, lo schema no),
      ~~i **comandi strutturali**~~ (fatti, [decisione 0013](../decisions/0013-elenco-delle-capacita.md): cinque comandi, sei comandi
      Tauri in meno) e i **comandi della shell** (toggle dei pannelli: il registro vive nel kernel e
      il frontend non può registrarvisi — §18.2).

- [ ] **La forma di una ricerca tollerante** ([todo.md](../todo.md) §21.1–§21.3,
      dalla [decisione 0025](../decisions/0025-la-ricerca-predefinita.md)):
      `text-mode`, `text-field`, `text-query` e `document-match` sono già nel WIT,
      e la 0025 ha stabilito che la ricerca predefinita di FubMD è di classe
      *omnisearch*. Le tre domande da chiudere qui:
      1. **Dove sta la tolleranza ai refusi** → una terza variante di `TextMode`
         è la più economica ma tratta modalità e tolleranza come esclusive,
         mentre sono ortogonali (una *frase* cercata a meno di un refuso ha
         senso); un campo a sé (`tolerance`, con `Exact` come default esplicito)
         costa un campo su ogni mirror e le tiene indipendenti. Nel contratto
         **non** deve entrare una distanza di edit: è un parametro di un motore, e
         metterlo in una firma vorrebbe dire che cambiare motore cambia il
         significato delle query salvate.
      2. **Come si dice che l'ultimo termine è incompleto** — è la proprietà di
         un'*invocazione*, non di una query salvata, e se la aggiunge la casella
         di ricerca allora CLI, automazioni e centro di comando LLM interrogano
         lo stesso indice in una lingua diversa da quella dell'utente.
      3. **Se un estratto porta coordinate nel documento** e, in tal caso, di
         quale revisione — `EditRequest` ha già la forma
         ([decisione 0008](../decisions/0008-modifica-chirurgica.md)). Senza,
         `ViewUpdate::Reveal` non ha niente da ricevere dalla ricerca e la ricerca
         dentro la nota aperta resta *inesprimibile*, non stretta.
      La ragione per cui tutto questo è contratto e non implementazione è una
      sola, e va riletta prima di rispondere: la tolleranza deve poter essere
      **spenta per singola query**, perché lo stesso `IndexQuery::Documents`
      serve la casella di ricerca e `vault.replace`.

## Trait/API coinvolti

- `Plugin`, `HostApi` (prima impl reale end-to-end).
- Tutti i trait, in sola lettura, per il freeze e il WIT.
- Registry del kernel: caricamento/attivazione plugin nativi.

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| WIT **vivo da M2**, freeze a M4 | La regola d'oro diventa verificabile ad ogni commit, non un atto di fede a fine corsa. |
| Primo plugin **nativo** prima del WASM | Separa "il confine è giusto?" da "il runtime WASM funziona?"; M5 resta meccanico. |
| JSON libero come `string` in WIT | Preserva l'escape hatch (`attrs`/`args`) senza esplodere il contratto. |
| L'`HostApi` è **chiusa** dalla [decisione 0013](../decisions/0013-elenco-delle-capacita.md) | Ventidue metodi, e ogni capacità esclusa ha una ragione scritta: dopo il freeze, una capacità mancante è una feature che non potrà mai essere un plugin, e "non ci avevamo pensato" non è un motivo che si possa leggere fra sei mesi. |
| Cambi additivi versionati post-freeze | Stabilità per i plugin di terzi senza bloccare l'evoluzione. |

## Criteri di accettazione

- `wit/fubmd/*.wit` copre l'intera superficie dei trait; il test di conformità
  abi↔WIT è verde e **rompe** su una divergenza introdotta ad arte.
- Il primo plugin nativo si attiva, registra i suoi provider, funziona end-to-end e
  rispetta i permessi (un accesso fuori `vault_scope` è negato con
  `PermissionDenied`). I permessi sono la metà che la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha lasciato al §7.3:
  il **rifiuto** esiste già ed è provato su tutte le strutturali; manca il
  registro dei manifest che dica *a chi* concedere.
- La superficie dei trait è dichiarata **congelata**; policy di versioning documentata.

## Piano di test

- **Conformità:** test abi↔WIT (fallimento indotto verificato).
- **Plugin nativo:** unit sul provider; e2e su attivazione/uso/disattivazione;
  test negativo sui permessi.
- **Regressione:** l'intera suite M1–M3 resta verde.
- `cargo test --workspace` + `cargo clippy` su tutti gli OS
  ([../appendix/platforms-ci.md](../appendix/platforms-ci.md)).

## Rischi / mitigazioni

- **Scoperta tardiva di una firma non-WIT** → mitigata a monte dal `wit/` vivo di M2;
  a M4 dovrebbero restare solo rifiniture.
- **Freeze prematuro** → il plugin nativo è l'ultima prova d'uso reale prima di
  chiudere; eventuali correzioni entrano prima del freeze.
- **Mapping del JSON libero** → confermare che `string`/`json` regga i casi reali di
  `attrs` (callout M3) e `args` (comandi).
