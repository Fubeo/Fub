# 9. Il lavoro lungo, e come un componente smette

Una **seduta** della [roadmap infrastrutturale](../todo.md): le tre facce del momento in cui un componente smette, più chi possiede i bundle.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quinto giro chiede di decidere insieme §9.2, §9.4 e ~~§9.1~~ — «tre facce del
momento in cui un componente smette, e oggi nessuna delle tre ha una risposta» —
e il §9.5 va con il §9.6, perché «chiudere una sessione» e «chiuderle tutte»
sono lo stesso codice. Il registry (9.3) sta qui perché è chi **possiede** i
bundle: senza di lui non c'è nessuno che apra e chiuda alcunché, e il runner dei
job non ha un chiamante in produzione.

La ~~9.1~~ andava sopra tutte per la ragione del quarto giro — non allargava una
capacità, ne rendeva una **inesprimibile** — ed è **chiusa** dalla
[decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md): un job
riceve l'`HostApi` intero, e lo riceve *per chiamata*. Delle tre facce ne restano
due, e la terza — un job in volo mentre il provider si spegne — è adesso una
domanda per il §9.2 e il §9.4 soli.

Il settimo giro ha aggiunto la 9.7, che sta qui perché è la 9.5 sull'altro asse:
là il watcher assente costa la **durabilità** di un indice, qui costa il fatto
stesso di sapere che il vault è cambiato — e nessuno chiede mai se il watcher
sia vivo.

### 9.2 Non c'è un ciclo di vita: si apre e basta

*ex §1.35 · contratto · **P0 condizionale** — scade col freeze **solo se** il gemello nasce senza default (era la stessa forma del §7.1, dove le due strade si sono rivelate due metà: [decisione 0021](../decisions/0021-il-confine.md))*

- [ ] **Il contratto non ha uno spegnimento.** `IndexProvider` ha `activate` e
      `flush` ma **nessun `close`/`deactivate`** (`abi/traits.rs`);
      `Plugin::deactivate` esiste (`abi/traits.rs`) e **non ha chiamanti**
      in tutto il repo — l'unico posto che lo nomina è il presidio di
      conformance. Un indice che possiede risorse esterne — tantivy tiene
      segmenti, lock file e thread di merge — non ha un punto in cui chiuderle,
      e il kernel non ha modo di chiedergliele.
- [ ] **L'asimmetria è di firma, ma scade col freeze solo su una delle due
      strade, e va detto quale.** Per `wit_additivity` una **funzione nuova** in
      un'interfaccia è additiva: `close` aggiunto dopo il freeze non rompe il
      WIT. Rompe **chi implementa**, e solo se nasce senza corpo di default —
      esattamente la differenza fra `IndexProvider::flush` (obbligatoria) e
      `Plugin::run_job` (che il default ce l'ha, `traits.rs`). Quindi
      la P0 non è sulla voce: è sulla scelta. *Se* il ciclo di vita deve essere
      obbligatorio — e per un indice che tiene lock file la risposta è
      probabilmente sì — allora va messo **prima** del freeze, perché dopo ogni
      provider di terzi già scritto smetterebbe di compilare. Se ammette un
      default no-op, è additiva e sta col §9.5, che è P1. È la stessa forma del
      §7.1: la voce è P0 **su una delle due strade**, e la strada va scelta ora.
      Là la risposta è stata «tutte e due, perché erano due metà»
      ([decisione 0021](../decisions/0021-il-confine.md)); qui non è detto che
      valga, ed è la domanda da porsi.
      La metà implementativa — chi chiama, quando, e cosa succede a metà — è il
      §9.5.
- [ ] Va deciso con il §9.4 (disattivazione a runtime): sono due facce del
      momento in cui un componente smette, e oggi nessuna delle due ha una
      risposta. La terza era il §9.1 — un job in volo mentre il provider si
      spegne — ed è **chiusa a metà**: la
      [decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md) ha
      dato al job le capacità, quindi il caso non è più ipotetico (un job in volo
      **scrive**), ma chi lo aspetta o lo ferma resta da decidere qui e nel §9.3.

*Sblocca:* 24.2 (safe mode, crash recovery, plugin isolation), 3.1 (switch fra
vault senza perdere scritture), 20.1 (lifecycle, enable/disable), 20.2 (hot
reload), 26.2-26.3 (dove il watcher non c'è).

### 9.3 Registry di plugin/feature e runner dei job

*ex §2.3 · kernel · **P1** — leva alta: è il registry su cui poggiano 9.4, 9.5 e il capitolo 7*

- [ ] **Una tabella di montaggio unica**: le feature sono cablate a mano in
      `mount` (`host/mount.rs`). La [decisione 0023](../decisions/0023-chi-monta-il-kernel.md)
      l'ha tolta da dentro un `#[tauri::command]` e messa in un posto solo — che
      è la precondizione di questa voce, non il suo rimpiazzo. Serve un registry
      che, dato un manifest, attivi/disattivi un bundle (`Plugin` + i suoi provider), assegni
      lo spazio dati, applichi `Trust` e `abi_compatible`. È il pezzo che a M5
      il caricatore WASM riuserà tale e quale.
- [ ] **Runner dei job**: un pool che draina `take_pending_jobs`, esegue
      `run_job` fuori dal lock e riconsegna con `complete_job`. Esiste il giro,
      esiste il test, **non esiste il chiamante in produzione**: oggi
      `spawn_job` accoda e basta. «Fuori dal lock» adesso vuol dire una cosa
      precisa e non più una figura: il workspace ha un `RwLock`
      ([decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)) e
      il job ha un host che il prestito se lo prende da sé, una chiamata alla
      volta ([decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md)
      — è `JobHost`, in `fubmd-host`). Il pool quindi **non deve tenere niente in
      mano** mentre chiama `run_job`: il ponte c'è, e ciò che resta da scrivere è
      chi lo usa. Prima di quella decisione un runner scritto qui avrebbe
      eseguito soltanto funzioni pure.
- [ ] **Cancellazione** — il terzo punto del §8.3, e sta qui perché prima del
      runner non c'è niente da cancellare: `spawn_job` accoda, e una coda non si
      ferma, si svuota. Un job che non si può fermare è un job che blocca la
      chiusura dell'app, il che lo lega al §9.5 (chi chiude aspetta chi?) e al
      §10.3 (dove l'utente vede il pulsante). Va disegnata **con** il runner, non
      dopo: un pool che non nasce cancellabile si riscrive per diventarlo.
- [ ] ~~**Namespace per-plugin sullo `storage_*`**~~ — **decaduta**: lo
      `storage_*` volatile è stato **ritirato** dal contratto dalla
      [decisione 0013](../decisions/0013-elenco-delle-capacita.md), quindi non c'è
      più niente da namespacare. Il recinto per-plugin che resta è quello dei
      `data_*`, che ce l'ha già (`plugin_data_dir`, che delega a `DocumentStore::plugin_data_root` in `documents.rs`). Dove il
      buco è rimasto aperto è lo **stato di vista**, che non ha più nemmeno un
      contenitore sbagliato: §11.2.
- [ ] **Safe mode / isolamento**: un provider che pania non deve portarsi via il
      vault (`catch_unwind` al confine, disattivazione con avviso) — 24.2, 20.3.
      La [decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)
      ne ha tolto **una metà**, e va detto quale: un `RwLock` si avvelena solo se
      a paniare è chi tiene il prestito esclusivo, quindi un provider che
      **disegna** non se lo porta più via. Chi **agisce** sì, ed è tutto lì
      dentro: `view_action` e `invoke_command` prendono `write()`
      (`app/lib.rs`), e `write_document` ci fa passare il parse del formato e
      l'alimentazione degli indici. Da lì il panico avvelena, e i quindici
      `.read()/.write().unwrap()` di `app/lib.rs` lo traducono in un panico su
      **ogni** comando successivo: non è la chiamata persa di cui parla la 0024,
      è il vault irraggiungibile fino al riavvio. Finché i provider sono in-repo
      è il caso raro; con un'estensione installata un handler di comando che
      pania è il caso normale — la metà che resta non è la metà meno probabile.

### 9.4 Disattivazione — oggi si può solo *non registrare*

*ex §2.9 · kernel · **P1** — presuppone la regola degli id (7.4)*

- [ ] **`unregister`/`deactivate` nel workspace**: `register_event_handler`,
      `register_index_provider` e `register_view_provider` fanno solo `push`.
      D7 ("spento = non registrato") funziona perché la decisione si prende
      all'avvio da una variabile d'ambiente; con le impostazioni del §11.1 va
      presa a runtime, e senza un modo di togliere un provider "spento" non
      significa più niente.
- [ ] **Definire la semantica nei casi scomodi**: `view_owner` restituisce
      **posizioni** in un `Vec` e i provider sono estratti per la durata di una
      chiamata — una disattivazione che arrivi in quel momento va decisa, non
      scoperta a runtime.

*Sblocca:* 20.1 (enable/disable, lifecycle), 20.2 (hot reload, developer mode),
20.3 (crash isolation, rollback, permission revocation), 24.2 (safe mode), 28.

### 9.5 Nessuno spegne niente: la durabilità dipende dal watcher

*ex §2.22 · kernel · **P1** — la metà implementativa della 9.2; va con la 9.6*

- [ ] **`flush_indexes` ha un solo chiamante in produzione**: il callback del
      file watcher (`host/watcher.rs`), più `reindex` all'apertura
      (`kernel/workspace.rs`, e lì l'esito è scartato con `let _ =` — cioè
      §20.3). Nessun altro percorso lo chiama — né `write_document` dall'IPC, né
      la chiusura del vault, né la chiusura dell'app.
- [ ] **Quindi la durabilità di un indice dipende da un componente
      *opzionale***. Dove il watcher non c'è o non funziona — network share e
      cartelle cloud (2.3, 3.1), PWA (26.3), CLI (27.1), e2e headless (27.4),
      mobile (26.2) — le scritture dell'indice **non diventano mai durevoli**, e
      il sintomo è solo una riapertura lenta che reindicizza tutto: nessuno se
      ne accorge finché non conta.
- [ ] **E cambiare vault o chiudere l'app non chiude niente**: nessun flush
      finale, nessun `Plugin::deactivate` (che non ha chiamanti), nessun
      `close` sugli indici (che non esiste — §9.2). tantivy resta con segmenti
      non committati e con i suoi lock; un journal (§15.2) resterebbe aperto; un
      sync (18) resterebbe a metà.
- [ ] Serve un **ciclo di vita esplicito del workspace** — `open` → `close` —
      con flush e deactivate di tutti i provider, la semantica di cosa succede
      se uno fallisce, e un punto di consistenza che **non sia il watcher**: il
      kernel non sa quando finisce un lotto (è dichiarato, ed è giusto), ma
      "l'app sta chiudendo" lo sa chi la chiude. Va con §9.6 (sessioni multiple:
      chiuderne una) e §9.3 (il registry è chi possiede i bundle).

### 9.6 Sessioni multiple

*ex §2.7 · kernel · **P2** — «chiuderne una» e «chiuderle tutte» sono lo stesso codice*

- [ ] **`Host` con una mappa di sessioni** (`vault_id -> VaultSession`) e i
      comandi IPC che portano il vault di riferimento; il vault "corrente" resta
      una comodità della shell, non un'assunzione del backend.
- [ ] **Registro dei vault** (recenti, preferiti, icone) nella configurazione
      globale (§11.1).

### 9.7 Il watcher è l'unico che vede le scritture altrui, e la sua morte non si vede

*settimo giro · kernel · **P1** — l'altra metà della 9.5: là il costo è la lentezza, qui è la correttezza*

- [ ] **Il §9.5 nomina già il watcher come componente opzionale da cui dipende
      la *durabilità* di un indice.** Questa voce è la stessa dipendenza vista
      sull'altro asse: il watcher è anche **l'unico** meccanismo con cui FubMD
      viene a sapere che qualcun altro ha toccato il vault. Non c'è nessun altro
      percorso — `reindex` gira solo all'apertura (`kernel/workspace.rs`),
      non esiste una riconciliazione periodica, e niente confronta mai la cache
      col disco. Il costo della sua assenza non è una riapertura lenta: è che il
      kernel risponde su un vault che non c'è più.
- [ ] **E quando fallisce, fallisce due volte in silenzio.** Gli errori del
      debouncer finiscono in un `eprintln!` (`host/watcher.rs`, cioè §20.2), e
      la sincronizzazione di ogni singolo path scarta il proprio esito:
      `let _ = ws.sync_renamed_path(&from, &to)` e `let _ = ws.sync_path(&p)`
      (`host/watcher.rs`) — due righe sopra un `flush_indexes` che almeno
      stampa. Un file esterno che non si legge o non si parsa lascia la cache, il
      grafo e l'indice fermi a **prima**, per sempre, senza che niente lo dica.
- [ ] **Nessuno chiede mai se il watcher è vivo.** Il debouncer viene tenuto in
      vita e basta (`VaultSession::watcher`, `host/session.rs`). La
      [decisione 0023](../decisions/0023-chi-monta-il-kernel.md) gli ha dato un
      trait — non era più un `Box<dyn Any + Send>` — e con lui un
      `VaultWatcher::is_watching` che oggi risponde **per costruzione**, cioè
      distingue `NoWatcher` da un debouncer avviato e nient'altro: nessuno
      gliela chiede, e un debouncer che muore continua a rispondere `true`.
      Quello è il posto dove questa voce andrà a scrivere. I casi in cui non funziona non
      sono di nicchia e FEATURES li nomina uno per uno: network share e cloud
      drive (2.3), vault sincronizzati con strumenti esterni (3.1, 18.1), il
      limite di inotify su vault grandi (24.1), e i tre host dove non esisterà
      affatto — CLI (27.1), PWA (26.3), mobile (26.2).
- [ ] **La conseguenza peggiore è una scrittura, non una lettura.** La
      [decisione 0008](../decisions/0008-modifica-chirurgica.md) ha dato la
      guardia giusta — una `base` nella firma, e `Conflict` invece della
      sovrascrittura silenziosa — ma vale per `apply_edit`, cioè per i *provider*.
      Il salvataggio dell'editor passa da `write_document` (`app/lib.rs`, che
      lo inoltra al workspace),
      che una base non ce l'ha: se il watcher non ha visto la scrittura altrui, il
      salvataggio successivo la copre e nessuna delle due metà del sistema è in
      grado di accorgersene. Col watcher vivo il caso è coperto a metà (la shell
      lo scrive in console, §20.4); col watcher morto non è coperto affatto.
- [ ] Cosa serve, e non è un watcher migliore: un **fatto interrogabile** —
      «questo vault ha o non ha il rilevamento delle modifiche esterne» — che la
      shell mostri e che una feature possa leggere, più un esito per la
      sincronizzazione per-path che smetta di essere scartato. La forma è quella
      del §7.6 — l'inventario di ciò che è attivo, che adesso **c'è**
      ([decisione 0021](../decisions/0021-il-confine.md)) — e il messaggio è quello del
      §20.2; la decisione da prendere qui è **cosa promette FubMD dove il
      rilevamento non c'è**, perché oggi promette la stessa cosa e ne mantiene
      un'altra.

*Sblocca:* 2.3 (rilevamento modifiche esterne, network drive, cloud drive,
rilevamento file lock — ~29 voci), 3.1 (vault sincronizzabili con tool esterni,
vault su USB), 18.1 (per-file status, conflict copies, sync health: ~52 voci che
danno per scontato di sapere quando il disco cambia), 19.2 (offline
collaboration recovery), 24.2 (file lock detection).
