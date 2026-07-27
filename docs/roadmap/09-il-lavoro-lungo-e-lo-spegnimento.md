# 9. Il lavoro lungo, e come un componente smette

Una **seduta** della [roadmap infrastrutturale](../todo.md): lo spegnimento è chiuso — le tre facce di un componente che smette, e la chiusura del vault intero — e restano chi possiede i bundle e chi si accorge che il vault cambia da fuori.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quinto giro chiedeva di decidere insieme ~~§9.2~~, ~~§9.4~~ e ~~§9.1~~ — «tre
facce del momento in cui un componente smette, e oggi nessuna delle tre ha una
risposta» — e ~~§9.5~~ andava con ~~§9.6~~, perché «chiudere una sessione» e
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

**E il vault si chiude.** La ~~9.5~~ e la ~~9.6~~ le chiude insieme, com'era
previsto, la [decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md):
chiudere è `VaultClosed` mentre tutti sono ancora vivi, poi un flush di tutti gli
indici — il punto di consistenza che non è il watcher — e poi ogni plugin che
smette in ordine inverso di dichiarazione. Sotto, `Host` ha smesso di tenere una
sessione sola: i vault aperti sono una mappa, ogni comando IPC accetta un
`vault` opzionale, e il "corrente" è tornato a essere ciò che diceva di essere —
una comodità della shell. Del §9.6 è rimasto fuori un punto solo, il **registro
dei vault** (recenti, preferiti, icone), che è configurazione globale e si è
spostato al [§11.1](11-impostazioni-e-i-tre-stati.md).

Quel che resta della seduta è quindi **chi possiede i bundle** (9.3) e **chi si
accorge che il vault cambia da fuori** (9.7).

Il settimo giro ha aggiunto la 9.7, che stava qui perché era la 9.5 sull'altro
asse: là il watcher assente costava la **durabilità** di un indice — e quel costo
la 0029 l'ha tolto, perché adesso il flush ha un chiamante che non è il watcher
— qui costa il fatto stesso di sapere che il vault è cambiato, e nessuno chiede
mai se il watcher sia vivo.

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
      chiusura dell'app, e adesso quella chiusura **esiste**
      ([decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)):
      oggi non aspetta nessuno perché non c'è nessuno in volo, e la domanda «chi
      chiude aspetta chi?» diventa dovuta il giorno in cui il runner c'è. L'altro
      lato è il §10.3 (dove l'utente vede il pulsante). Va disegnata **con** il
      runner, non dopo: un pool che non nasce cancellabile si riscrive per
      diventarlo.
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

### 9.7 Il watcher è l'unico che vede le scritture altrui, e la sua morte non si vede

*settimo giro · kernel · **P1** — l'altra metà della ~~9.5~~: là il costo era la lentezza ed è **stato pagato** ([0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)), qui è la correttezza e resta aperto*

- [ ] **Il ~~§9.5~~ nominava il watcher come componente opzionale da cui
      dipendeva la *durabilità* di un indice, e quella metà è chiusa**: il flush
      adesso ha un chiamante che non è il watcher — la chiusura del vault
      ([decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)).
      Questa voce è la stessa dipendenza vista sull'altro asse, e la chiusura non
      la tocca: il watcher è anche **l'unico** meccanismo con cui FubMD viene a
      sapere che qualcun altro ha toccato il vault *mentre è aperto*. Non c'è
      nessun altro percorso — `reindex` gira solo all'apertura
      (`kernel/workspace.rs`), non esiste una riconciliazione periodica, e niente
      confronta mai la cache col disco. Il costo della sua assenza non è più una
      riapertura lenta: è che il kernel risponde su un vault che non c'è più.
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
      Quello è il posto dove questa voce andrà a scrivere — e adesso la domanda
      si fa **per vault** (`Host::is_watching(vault)`,
      [decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)),
      il che rende la risposta per-vault e non più per-app: due vault possono
      avere due watcher, uno vivo e uno morto. I casi in cui non funziona non
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
