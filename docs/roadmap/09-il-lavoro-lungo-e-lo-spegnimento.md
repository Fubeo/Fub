# 9. Il lavoro lungo, e come un componente smette

Una **seduta** della [roadmap infrastrutturale](../todo.md): le tre facce del momento in cui un componente smette, più chi possiede i bundle.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quinto giro chiede di decidere insieme §9.2, §9.4 e §9.1 — «tre facce del
momento in cui un componente smette, e oggi nessuna delle tre ha una risposta» —
e il §9.5 va con il §9.6, perché «chiudere una sessione» e «chiuderle tutte»
sono lo stesso codice. Il registry (9.3) sta qui perché è chi **possiede** i
bundle: senza di lui non c'è nessuno che apra e chiuda alcunché, e il runner dei
job non ha un chiamante in produzione.

La 9.1 va sopra tutte per la ragione del quarto giro: non allarga una capacità,
ne rende una **inesprimibile**. Finché il lavoro lungo non può leggere il vault,
i capitoli 17, 18, 22 e 19.4 non hanno un posto dove girare.

Il settimo giro ha aggiunto la 9.7, che sta qui perché è la 9.5 sull'altro asse:
là il watcher assente costa la **durabilità** di un indice, qui costa il fatto
stesso di sapere che il vault è cambiato — e nessuno chiede mai se il watcher
sia vivo.

### 9.1 Il lavoro lungo non vede il vault

*ex §1.21 · contratto · **P0** — leva alta: **rende inesprimibile** — sblocca 17, 18, 22, 19.4*

- [ ] **`Plugin::run_job` è deliberatamente senza `HostApi`** — «input nel
      `payload`, output nel risultato» (`abi/traits.rs:1052-1064`). Per un
      calcolo puro è la firma giusta. Ma l'unico modo di dare input a un job
      diventa che il **chiamante** legga il vault dentro il giro sincrono:
      cioè faccia lì, in esclusiva sul workspace, esattamente il lavoro che il
      job doveva togliere da lì.
- [ ] **Il conto di ciò che con questa firma non è esprimibile**: import ed
      export (17, ~120 voci), embedding e RAG locale (22.1-22.3), sync (18.1),
      backup e snapshot (18.2), sito statico (19.4), OCR e trascrizione (13.4),
      health check e diagnostic bundle (24.2), reindicizzazione (24.1). Tutte
      camminano il vault, e quasi tutte ci scrivono.
- [ ] **La [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ci sta già costruendo sopra**: `http_fetch` «solo dentro un
      job». Ma un web clipper (14.2) fa fetch *e* scrive una nota *e* scarica
      gli allegati: con la firma attuale la sola parte che può stare nel job è
      la fetch, e il resto torna nel giro sincrono. Idem per «import da URL»
      (17.1) e per i modelli scaricabili (22.3).
- [ ] **Le due strade, da scegliere ora**: un `JobHost` in **sola lettura** su
      uno snapshot coerente del vault, oppure scritture differite al `JobDone`
      con una semantica dichiarata di cosa succede se il vault è cambiato nel
      frattempo. La seconda domanda è la stessa della [decisione 0008](../decisions/0008-modifica-chirurgica.md) (l'edit calcolato su
      una revisione), e va risolta una volta per entrambi. È forma di firma di
      un trait: dopo il freeze si cambia con una major.

*Sblocca:* 17 per intero, 18.1-18.2, 19.4, 22, 13.4, 14.2, 24.1-24.2, e il
runner dei job del §9.3, che oggi eseguirebbe soltanto funzioni pure.

### 9.2 Non c'è un ciclo di vita: si apre e basta

*ex §1.35 · contratto · **P0 condizionale** — scade col freeze **solo se** il gemello nasce senza default (era la stessa forma del §7.1, dove le due strade si sono rivelate due metà: [decisione 0021](../decisions/0021-il-confine.md))*

- [ ] **Il contratto non ha uno spegnimento.** `IndexProvider` ha `activate` e
      `flush` ma **nessun `close`/`deactivate`** (`abi/traits.rs:917-949`);
      `Plugin::deactivate` esiste (`abi/traits.rs:1051`) e **non ha chiamanti**
      in tutto il repo — l'unico posto che lo nomina è il presidio di
      conformance. Un indice che possiede risorse esterne — tantivy tiene
      segmenti, lock file e thread di merge — non ha un punto in cui chiuderle,
      e il kernel non ha modo di chiedergliele.
- [ ] **L'asimmetria è di firma, ma scade col freeze solo su una delle due
      strade, e va detto quale.** Per `wit_additivity` una **funzione nuova** in
      un'interfaccia è additiva: `close` aggiunto dopo il freeze non rompe il
      WIT. Rompe **chi implementa**, e solo se nasce senza corpo di default —
      esattamente la differenza fra `IndexProvider::flush` (obbligatoria) e
      `Plugin::run_job` (che il default ce l'ha, `traits.rs:1058-1064`). Quindi
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
- [ ] Va deciso con il §9.4 (disattivazione a runtime) e il §9.1 (un job in
      volo mentre il provider si spegne): sono tre facce del momento in cui un
      componente smette, e oggi nessuna delle tre ha una risposta.

*Sblocca:* 24.2 (safe mode, crash recovery, plugin isolation), 3.1 (switch fra
vault senza perdere scritture), 20.1 (lifecycle, enable/disable), 20.2 (hot
reload), 26.2-26.3 (dove il watcher non c'è).

### 9.3 Registry di plugin/feature e runner dei job

*ex §2.3 · kernel · **P1** — leva alta: è il registry su cui poggiano 9.4, 9.5 e il capitolo 7*

- [ ] **Una tabella di montaggio unica**: oggi le feature sono cablate a mano in
      `open_vault` (`app/lib.rs:140-204`). Serve un registry che, dato un
      manifest, attivi/disattivi un bundle (`Plugin` + i suoi provider), assegni
      lo spazio dati, applichi `Trust` e `abi_compatible`. È il pezzo che a M5
      il caricatore WASM riuserà tale e quale.
- [ ] **Runner dei job**: un pool che draina `take_pending_jobs`, esegue
      `run_job` fuori dal lock e riconsegna con `complete_job`. Esiste il giro,
      esiste il test, **non esiste il chiamante in produzione**: oggi
      `spawn_job` accoda e basta.
- [ ] ~~**Namespace per-plugin sullo `storage_*`**~~ — **decaduta**: lo
      `storage_*` volatile è stato **ritirato** dal contratto dalla
      [decisione 0013](../decisions/0013-elenco-delle-capacita.md), quindi non c'è
      più niente da namespacare. Il recinto per-plugin che resta è quello dei
      `data_*`, che ce l'ha già (`plugin_data_dir`, `workspace.rs:2177`). Dove il
      buco è rimasto aperto è lo **stato di vista**, che non ha più nemmeno un
      contenitore sbagliato: §11.2.
- [ ] **Safe mode / isolamento**: un provider che pania non deve portarsi via il
      vault (`catch_unwind` al confine, disattivazione con avviso) — 24.2, 20.3.

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
      file watcher (`app/lib.rs:279`), più `reindex` all'apertura
      (`kernel/workspace.rs:466`, e lì l'esito è scartato con `let _ =` — cioè
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

- [ ] **`AppState` con una mappa di sessioni** (`vault_id -> VaultSession`) e i
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
      percorso — `reindex` gira solo all'apertura (`kernel/workspace.rs:438`),
      non esiste una riconciliazione periodica, e niente confronta mai la cache
      col disco. Il costo della sua assenza non è una riapertura lenta: è che il
      kernel risponde su un vault che non c'è più.
- [ ] **E quando fallisce, fallisce due volte in silenzio.** Gli errori del
      debouncer finiscono in un `eprintln!` (`app/lib.rs:285`, cioè §20.2), e
      la sincronizzazione di ogni singolo path scarta il proprio esito:
      `let _ = ws.sync_renamed_path(&from, &to)` e `let _ = ws.sync_path(&p)`
      (`app/lib.rs:266`, `:272`) — due righe sopra un `flush_indexes` che almeno
      stampa. Un file esterno che non si legge o non si parsa lascia la cache, il
      grafo e l'indice fermi a **prima**, per sempre, senza che niente lo dica.
- [ ] **Nessuno chiede mai se il watcher è vivo.** Il debouncer viene messo in
      un `Box<dyn Any + Send>` e tenuto in vita e basta
      (`VaultSession::_watcher`, `app/lib.rs:42`). I casi in cui non funziona non
      sono di nicchia e FEATURES li nomina uno per uno: network share e cloud
      drive (2.3), vault sincronizzati con strumenti esterni (3.1, 18.1), il
      limite di inotify su vault grandi (24.1), e i tre host dove non esisterà
      affatto — CLI (27.1), PWA (26.3), mobile (26.2).
- [ ] **La conseguenza peggiore è una scrittura, non una lettura.** La
      [decisione 0008](../decisions/0008-modifica-chirurgica.md) ha dato la
      guardia giusta — una `base` nella firma, e `Conflict` invece della
      sovrascrittura silenziosa — ma vale per `apply_edit`, cioè per i *provider*.
      Il salvataggio dell'editor passa da `write_document` (`app/lib.rs:316-321`),
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
