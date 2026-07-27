# 9. Il lavoro lungo, e come un componente smette

Una **seduta** della [roadmap infrastrutturale](../todo.md): le tre facce del momento in cui un componente smette — tutte e tre chiuse — più chi possiede i bundle, chi chiude il vault e chi si accorge che il vault cambia da fuori.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quinto giro chiedeva di decidere insieme ~~§9.2~~, ~~§9.4~~ e ~~§9.1~~ — «tre
facce del momento in cui un componente smette, e oggi nessuna delle tre ha una
risposta» — e il §9.5 va con il §9.6, perché «chiudere una sessione» e
«chiuderle tutte» sono lo stesso codice. Il registry (9.3) sta qui perché è chi
**possiede** i bundle: senza di lui non c'è nessuno che apra e chiuda alcunché, e
il runner dei job non ha un chiamante in produzione.

**Le tre facce sono chiuse.** La ~~9.1~~ andava sopra tutte per la ragione del
quarto giro — non allargava una capacità, ne rendeva una **inesprimibile** — ed è
chiusa dalla [decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md):
un job riceve l'`HostApi` intero, e lo riceve *per chiamata*. Le altre due —
~~9.2~~ (il contratto non ha uno spegnimento) e ~~9.4~~ (si può solo *non
registrare*) — le chiude la [decisione 0028](../decisions/0028-come-un-componente-smette.md):
`IndexProvider::close` è **obbligatoria**, e `Workspace::deactivate_plugin` è
l'inverso esatto della strada di registrazione. Lì è finita anche la terza faccia
per intero: i job in coda di chi si spegne ricevono un esito, e le capacità di un
job in volo evaporano da sé — la politica se la fa dare dal registro a ogni
chiamata, e un id che nessuno ha più dichiarato non ottiene niente.

Quel che resta della seduta è quindi **chi possiede i bundle** (9.3), **chi
chiude il vault** (9.5 con 9.6) e **chi si accorge che il vault cambia da fuori**
(9.7).

Il settimo giro ha aggiunto la 9.7, che sta qui perché è la 9.5 sull'altro asse:
là il watcher assente costa la **durabilità** di un indice, qui costa il fatto
stesso di sapere che il vault è cambiato — e nessuno chiede mai se il watcher
sia vivo.

### 9.3 Registry di plugin/feature e runner dei job

*ex §2.3 · kernel · **P1** — leva alta: è chi userà la disattivazione della [0028](../decisions/0028-come-un-componente-smette.md), ed è il registry su cui poggiano la 9.5 e il capitolo 7*

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

### 9.5 Nessuno spegne niente: la durabilità dipende dal watcher

*ex §2.22 · kernel · **P1** — la metà *del workspace* di ciò che la [0028](../decisions/0028-come-un-componente-smette.md) ha dato al singolo plugin; va con la 9.6*

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
      finale, nessun `Plugin::deactivate` (che non ha ancora chiamanti — è il
      §9.3), e nessuno che chiami `Workspace::deactivate_plugin`, che **adesso
      esiste** ([0028](../decisions/0028-come-un-componente-smette.md)) e chiude
      gli indici di chi si spegne. Il mattone c'è e non lo usa nessuno: tantivy
      resta con segmenti non committati e con i suoi lock finché il processo non
      muore; un journal (§15.2) resterebbe aperto; un sync (18) resterebbe a
      metà.
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
