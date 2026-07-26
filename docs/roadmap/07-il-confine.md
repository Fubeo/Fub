# 7. Il confine: quante volte si scrive la disciplina

Una **seduta** della [roadmap infrastrutturale](../todo.md): la disciplina del confine, vista da chi lo attraversa e da chi lo presta.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il §7.1 e il §7.2 sono «la stessa domanda vista una volta dal lato di chi il
confine lo attraversa (i provider) e una dal lato di chi lo presta (l'host)», e
il sesto giro chiede di deciderle insieme. Con loro sta il §7.3, che le
**moltiplica**: i permessi vogliono politiche combinatorie, e con la forma di
oggi ogni politica è un'altra impl da ventidue metodi.

La 7.1 entra in P0 **solo se** si sceglie la scomposizione in sotto-trait —
quella è firma, e spostare una funzione da una interface WIT a un'altra il
presidio dell'additività ([decisione 0002](../decisions/0002-additivita-del-contratto.md))
lo conta come rinomina. Se invece si sceglie il solo wrapper nel kernel, scala a
P1 e non blocca niente.

La 7.5 fa il percorso opposto e per la stessa ragione: pesa quanto le altre —
senza, i moduli Suite sono crate linkati e non plugin — ma la sua sostanza è
**additiva** per il presidio dell'additività, quindi non scade col freeze ed è
P1. Il criterio dell'indice è la scadenza, non l'importanza, e se lo si piega
una volta smette di ordinare alcunché.

La 7.4 sta qui ed è la voce **più datata** del piano: è l'unica che non riguarda
ciò che scriveremo ma ciò che avremo già pubblicato, e il suo costo non si misura
in lavoro ma in id di terzi da rinominare.

### 7.1 Una capacità dell'`HostApi` si implementa quattro volte a mano

*ex §1.38 · contratto · **P0** — P0 se sotto-trait, P1 se solo wrapper — leva alta in entrambi i casi*

- [ ] **22 metodi, 4 implementazioni complete**: `KernelHost`
      (`workspace.rs:2339`), `ReadHost` (`:2535`), `ReadOnlyHost` (`:2720`) e
      `MemoryHost` (`features/src/testing.rs:179`). Il proxy WASM di M5 è la
      quinta. Ottantotto corpi di metodo, più il WIT, più l'arena.
- [ ] **Il §16.4 conta quattro posti per un *tipo* nuovo; nessuno conta i posti
      per una *capacità* nuova.** E la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha chiuso l'elenco a ventidue
      argomentando sulla **firma** («aggiungerne uno è una minor»): il costo
      vero non è quello, è questo — e non si paga aggiungendo la ventitreesima,
      si paga a ogni implementazione futura dell'host.
- [ ] **Il §7.3 lo moltiplica, non lo eredita.** I permessi vogliono politiche
      *combinatorie* — `write_vault` × `network` × `Trust` × manifest — e con
      questa forma ogni politica è un'altra impl da 22 metodi. `ReadOnlyHost` è
      già la prova: esiste solo per dire «no» a sei capacità, e per dirlo ha
      dovuto riscriverne ventidue (sedici delle quali delegano a `ReadHost`
      riga per riga, e il commento in cima lo dice).
- [ ] **Le due strade, e non sono equivalenti.** La prima è di sola
      implementazione e sta tutta nel kernel: `kernel/src/host/` (`kernel.rs`,
      `read.rs`, `guard.rs`, `mod.rs`) dove il rifiuto è un **wrapper
      generico** `Guard<H, P: Policy>` invece di una impl gemella — costa poco,
      non tocca il contratto, e il §7.3 ci atterra sopra invece di aggiungere
      la quinta copia. La seconda è di **firma**, quindi P0: spezzare `HostApi`
      in sotto-trait per famiglia (lettura, scrittura di testo, strutturali,
      dati, eventi, query, sessione) con `HostApi: ReadApi + WriteApi + …`, così
      che «sola lettura» sia *un tipo che non implementa `WriteApi`* invece di
      un tipo che implementa venti rifiuti. La seconda è quella che regge il
      §7.3; e va decisa **prima del freeze**, perché spostare una funzione da
      una interface WIT a un'altra il `wit_additivity` lo conta come rinomina
      ([decisione 0002](../decisions/0002-additivita-del-contratto.md)), cioè come rottura.
- [ ] Da decidere insieme al §7.2 (`ProviderTable`): sono la stessa domanda —
      *quante volte si scrive la disciplina del confine* — vista una volta dal
      lato di chi il confine lo attraversa (i provider) e una dal lato di chi lo
      presta (l'host).

*Sblocca:* 20.3 (sandbox, permessi, revoca), 23.1, e ogni capacità futura della
[decisione 0013](../decisions/0013-elenco-delle-capacita.md) — comprese quelle che ha lasciato fuori nominandole (`http_fetch`,
`schedule_at`, `notify`, gli asset), che il giorno che entreranno entreranno
cinque volte.

### 7.2 Una disciplina dei provider sola, non una per famiglia

*ex §2.8 · kernel · **P1** — va **prima** dei provider nuovi del capitolo 2, o li si scrive tre volte*

- [ ] **`ProviderTable<T>`**: `deliver_to_handlers` (`workspace.rs:2078`),
      `flush_indexes` (`:1450`) e `view_action` (`:1533`) implementano **tre
      volte** lo stesso protocollo sottile — `mem::take` dei provider →
      `with_provider_call` → ripristino → `extend(registered_meanwhile)` →
      `dispatch_pending`. Non è codice di servizio: è la semantica di consegna
      che il component model impone a M5, ed è già triplicata. [decisione 0009](../decisions/0009-registro-dei-comandi.md) (comandi),
      §11.1 (settings) e [decisione 0006](../decisions/0006-import-export-come-trait.md) (import/export) ne aggiungerebbero altre tre copie.
- [ ] Una tabella sola è anche il posto in cui atterrano §9.4 (disattivazione),
      §7.3 (permessi e trust) e il `catch_unwind` del §9.3 — e a M5 il
      caricatore WASM la riusa invece di scrivere la quarta copia.

### 7.3 Permessi e manifest — il punto di applicazione non esiste

*ex §2.10 · kernel · **P1** — leva alta, con la 7.2*

- [ ] **Il registry tiene `(manifest, permessi, trust)`** e `KernelHost` si
      costruisce da quella voce: oggi `PluginPermissions` esiste nel contratto e
      **nessuno lo legge**, e `KernelHost` porta `plugin: &str` e `mode`, e
      nient'altro (`workspace.rs:2325-2337`) — non sa di chi siano le capacità
      che sta prestando.
      Il kernel non conserva manifest: `register_*` prende una stringa.
- [ ] **`Trust` va oltre le view**: oggi è un parametro del solo
      `register_view_provider`. Un `IndexProvider` di terzi riceverebbe *ogni*
      documento del vault via `on_document_indexed` senza che `read_vault` sia
      mai consultato.
- [ ] Ogni capacità della [decisione 0013](../decisions/0013-elenco-delle-capacita.md) (`http_fetch` sotto `network`, le operazioni
      strutturali sotto `write_vault`, `run_command`) presuppone un controllo che
      non ha casa. Se non nasce qui finirà sparso nei punti di chiamata — il
      contrario dell'enforcement in un punto solo già ottenuto per la UI.
- [ ] **Il varco però esiste già, e la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) gliel'ha allargato**: un comando
      simulato o dichiarato di sola lettura riceve un host che nega *tutte* le
      strutturali, con un messaggio che dice perché. Ciò che manca a
      `write_vault` non è il rifiuto: è il **registro che tiene i manifest**,
      perché `Plugin::manifest()` non viene chiamata da nessuna parte e questo
      kernel non ha plugin, ha provider registrati per id. È la differenza con
      `CommandScope.writes`, che è vincolante perché la dichiarazione e l'atto
      sono la stessa cosa e l'host ha la spec in mano. Questa voce deve portare
      il registro, non l'`if`.

### 7.4 Gli id non sono di nessuno: nessuna regola di namespace, nessuna collisione

*ex §1.34 · contratto · **P0** — la più **datata**: riguarda ciò che è già pubblicato*

- [ ] **`view_owner` risolve un id cercando su tutti i provider e prende il
      primo** (`kernel/workspace.rs:1566-1571`): due view con lo stesso id e la
      seconda è irraggiungibile, **in silenzio**. È lo stesso difetto che il
      `FormatRegistry` aveva (§3.1: l'ultimo registrato vinceva) e che il
      dispatch delle query ha ancora (§5.2: per tentativi). Il primo è chiuso
      dalla [decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md),
      e la forma della risposta è quella da riusare qui: la registrazione
      restituisce un `Result`, il perdente **non si registra affatto**, e
      sostituire resta possibile ma si chiede per nome.
- [ ] **Gli spazi di nomi del contratto sono otto e nessuno ha una regola**: id
      di view, `ActionId`, id di comando ([decisione 0009](../decisions/0009-registro-dei-comandi.md)), `custom_kind` dei blocchi
      — dove la [decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)
      ha già fissato *core senza prefisso, terzi con `ns:`* e la fa rispettare
      agli id di regole e renderer, ma non ancora ai kind —, topic degli
      `Event::Custom`, `ns` delle `IndexQuery::Custom` e dei
      `ViewUpdate::Custom`, chiavi di impostazione (§11.1), nomi dei job. Solo
      per gli eventi custom c'è una convenzione scritta (`"<plugin-id>/<nome>"`,
      `abi/event.rs:39-41`), e non è imposta da nulla.
- [ ] **La decisione è una sola**: l'id è namespaced sull'id del plugin, il
      kernel lo impone alla registrazione e la collisione è un errore
      dichiarato — oppure ogni famiglia se lo inventa. Costa una regola adesso;
      dopo il freeze costa rinominare ogni id già pubblicato, cioè rompere le
      hotkey, le impostazioni salvate e i link a view di chiunque abbia
      scritto un plugin nel frattempo. È anche il presupposto di §9.4 (togliere
      un provider: per id) e §5.2 (routing: per `ns`).

### 7.5 I plugin non hanno un canale per parlarsi

*ex §1.24 · contratto · **P1** — leva altissima, ma **additiva**: non scade col freeze*

- [ ] **Gli unici canali fra provider sono `Event::Custom`** — fire-and-forget,
      senza risposta — **e `IndexQuery::Custom`**, che è il canale *indice* e
      passa dal dispatch a tentativi del §5.2. Non esiste una **chiamata**: A
      non può chiedere qualcosa a B e ricevere un risultato.
- [ ] **Il capitolo 21 lo dà per scontato a ogni riga**: 21.1 promette «plugin
      Suite con API condivise»; 21.2 ha FubCharts che disegna dati di FubDB,
      FubForms che scrive in FubDB, FubCalendar che legge da FubTasks,
      FubFlashcards che legge blocchi di note. Il 20.1 chiede «dipendenze
      plugin» e «conflitti plugin», il 20.3 «conflict detection».
- [ ] **Serve la terna, e va decisa insieme**: `provides`/`requires` nel
      `PluginManifest` (che oggi ha id, nome, versione, abi, permessi —
      `abi/traits.rs:1008-1023`); un `HostApi::call_service(ns, method, args)`
      sotto permesso; e l'**ordine di attivazione** che ne discende, con la
      semantica dichiarata del requisito mancante (il dipendente si disattiva?
      si attiva degradato?). Il §9.3 nomina il registry come tabella di
      montaggio: qui diventa anche un risolutore di dipendenze.
- [ ] **Perché P1 e non P0, che è il contrario di quanto pesa.** La terna, per
      il presidio dell'additività, è tutta **aggiunta**: `wit_additivity` conta
      come additivi una funzione nuova in un'interfaccia (`call_service`) e un
      campo **in fondo** a un `record` (`provides`/`requires` su
      `PluginManifest`). È lo stesso argomento con cui la
      [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha chiuso
      l'elenco delle capacità a ventidue — «aggiungerne uno è una minor» — e che
      il §7.1 ripete. Il criterio di [todo.md](../todo.md) è esplicito: la
      scadenza fa la P0, **non** l'importanza. Questa voce ha l'importanza e non
      la scadenza, e va presa presto per la leva, non per il freeze. L'unico
      pezzo che scadrebbe è una scelta che qui non si sta facendo: mettere
      `call_service` in un'interfaccia WIT **diversa** da quella dove finirà —
      spostarla dopo il `wit_additivity` la conta come rinomina (§7.1, ultimo
      punto).
- [ ] Senza, i moduli Suite non saranno plugin: saranno crate linkati che si
      vedono a compile time — cioè il contrario del §16.3.

*Sblocca:* 21.1-21.2 (i moduli Suite come plugin veri), 20.1 (dipendenze,
conflitti, lifecycle), 11 (colonne e funzioni di query di terzi), 27.2 (API
plugin), 16.2 (automazioni che compongono feature diverse).

### 7.6 Nessun inventario di ciò che è attivo

*ex §2.25 · kernel · **P1** — nasce dal registry della 9.3*

- [ ] **`VaultInfo.versioning: bool`** (`app/lib.rs:63`, mirror in `api.ts:14`)
      è un booleano **per feature** dentro un record IPC. Con i moduli del 21.2
      diventano venti booleani, e ognuno è una modifica al record, al mirror e
      alla fixture (§16.4).
- [ ] **E la shell non sa comunque nulla del resto**: quali provider, indici,
      handler e comandi siano registrati, con quale manifest, quale versione,
      quali permessi, quale `Trust`. Il kernel non conserva i manifest
      (`register_*` prende una stringa, §7.3), quindi la domanda non ha proprio
      un destinatario.
- [ ] Serve un `capabilities()`/`list_plugins` sul confine, alimentato dal
      registry del §9.3: è ciò su cui poggiano la scheda impostazioni (§11.1), il
      pannello plugin con enable/disable (20.1), il developer mode (20.2), la
      diagnostica e il diagnostic bundle (24.2) — e il modo di far sparire i
      booleani prima che diventino venti.
