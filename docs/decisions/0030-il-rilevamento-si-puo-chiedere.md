# 0030 — Il rilevamento si può chiedere: una bandiera sola, e gli esiti che smettono di essere buttati

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §9.7 (seduta 9) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md)

---

Il file watcher è **l'unico** meccanismo con cui Fub viene a sapere che qualcun
altro ha toccato il vault. Non ce n'è un secondo: `reindex` gira solo
all'apertura, non esiste una riconciliazione periodica, e niente confronta mai
la cache col disco. Da lì venivano tre silenzi, ed erano lo stesso silenzio:

- **nessuno chiedeva se fosse vivo.** `VaultWatcher::is_watching` rispondeva
  *per costruzione* — distingueva «non ho avviato un debouncer» da «ne ho
  avviato uno» — e nessun chiamante gliela faceva, quella domanda. Un debouncer
  che moriva (limite di inotify su un vault grande, un network share che si
  stacca) continuava a rispondere `true` per sempre;
- **quando falliva, falliva in silenzio due volte.** Gli errori del debouncer
  finivano in un `eprintln!`, e la sincronizzazione di ogni singolo path
  scartava il proprio esito: `let _ = ws.sync_renamed_path(…)` e
  `let _ = ws.sync_path(…)`. Un file esterno che non si legge o non si parsa
  lasciava la cache, il grafo e l'indice fermi a **prima**, per sempre;
- **e i casi in cui non funziona non sono di nicchia.** FEATURES li nomina uno
  per uno: network share e cloud drive (2.3), vault sincronizzati con strumenti
  esterni (3.1, 18.1), il limite di inotify sui vault grandi (24.1), e i tre
  host dove non esisterà affatto — CLI (27.1), PWA (26.3), mobile (26.2).

La [0029](0029-chiudere-un-vault-e-chiuderli-tutti.md) aveva tolto l'altra metà
di questa dipendenza: la **durabilità** di un indice non passa più dal watcher,
perché il flush ha un chiamante che è la chiusura del vault. Quella metà costava
lentezza. Questa costa correttezza, ed è rimasta.

## La risposta, in una frase

**«Questo vault sa quando cambia da fuori?» è una domanda del canale dati
(`IndexQuery::VaultStatus`), la risposta viene da una bandiera sola che il
kernel presta e che tiene chi guarda davvero, e ogni sincronizzazione per-path
che fallisce resta scritta nel vault anche quando il chiamante butta via il
proprio `Result`.**

## Le decisioni prese, da NON ridiscutere senza motivo

- **Un fatto interrogabile dal canale dati, non un comando IPC.** I clienti sono
  due e uno dei due non ha comandi: la shell ha `query_index`, una feature ha
  `HostQuery` e nient'altro. Un comando Tauri nuovo avrebbe reso il fatto
  visibile solo alla prima — cioè una cosa che il core sa e i plugin no, che è
  precisamente la forma di debito che la [0019](0019-il-canale-dati.md) ha
  chiuso. La forma è quella del §7.6 (l'inventario di ciò che è attivo,
  [0021](0021-il-confine.md)): si chiede, non si riceve.
- **Tre campi e non un booleano**, ed è la parte da non semplificare dopo.
  `watching` è «Fub **saprebbe**», `sync_failures` è «è **già** successo
  qualcosa che non ho saputo leggere», `last_sync_error` è «cosa». Un booleano
  solo avrebbe confuso un vault senza rilevamento — rischio noto e permanente,
  che si mitiga riaprendo — con un vault che il rilevamento ce l'ha e ha appena
  mancato un file, che è un incidente e ha un colpevole con un nome.
- **La bandiera è UNA, e la tiene chi guarda.** Il kernel la possiede
  (`Workspace::watch_flag` la presta come `Arc<AtomicBool>`) e chi avvia un
  rilevatore la alza; il debouncer la abbassa quando riporta errori e quando
  viene distrutto. Non un valore **copiato** dentro il kernel al montaggio: una
  copia è una seconda verità, e sarebbe stata alzata una volta e mai più
  abbassata — cioè lo stesso `true` perenne di prima, spostato di un livello. Il
  presidio è che `Host::is_watching` e `IndexQuery::VaultStatus` leggono lo
  stesso bit, e fallisce se la funzione ne rende uno nuovo.
- **La serve il `CoreIndex`, non un ramo prima del router.** «Le risposte del
  kernel sono un provider» è la [0019](0019-il-canale-dati.md), e intercettare
  una variante dentro `Workspace::query_index` avrebbe rimesso il ramo
  privilegiato che quella decisione ha tolto. Ne segue dove vive lo stato: nel
  `CoreIndex`, perché è lui che deve rispondere — e perché è l'unico che conosce
  **tutte e due** le metà della risposta, la bandiera di chi monta e l'esito
  delle sincronizzazioni.
- **Gli esiti si registrano DENTRO il kernel.** Non «i chiamanti smettano di
  scrivere `let _ =`»: un chiamante distratto è la condizione normale, e una
  regola che chiede attenzione a ogni chiamata la perde alla prima riga scritta
  di fretta. `sync_path` e `sync_renamed_path` registrano da sé e
  **restituiscono quello che restituivano**: il `Result` resta identico per chi
  lo legge, e chi non lo legge non può più nasconderlo. Il presidio chiama
  `let _ = ws.sync_path(…)` esattamente come il watcher, e chiede al vault se se
  ne ricorda.
- **Il conto non si azzera da solo.** Una sincronizzazione riuscita dopo una
  fallita non cancella la fallita: «è già successo» resta vero, e ciò che è
  rimasto indietro non torna indietro da sé — chi vuole ripartire pulito riapre
  il vault, che è l'unica operazione che rilegge tutto.
- **E il conto non blocca niente.** `sync_failures` è una memoria, non uno
  stato: il vault continua a funzionare, e il documento che al secondo tentativo
  si legge entra. Un contatore che avesse messo il vault in sola lettura avrebbe
  trasformato un file con un encoding strano in un'app che non salva.

### Cosa promette Fub dove il rilevamento non c'è

È la domanda che il §9.7 poneva come la decisione vera, perché «oggi promette la
stessa cosa e ne mantiene un'altra». La risposta:

**Fub promette che la verità è il vault sul disco, e che le proprie risposte ne
sono un riflesso aggiornato *soltanto quando `watching` è vero*. Dove non lo è,
la promessa è più piccola, ed è questa: ciò che passa da Fub è coerente; ciò che
passa da fuori si vede alla riapertura.**

Due conseguenze che vanno con la frase, o la frase non vale niente:

- **la promessa più piccola è dichiarata, non implicita.** Prima era la stessa
  promessa per tutti e i due casi erano indistinguibili; adesso la differenza è
  un campo che chiunque può leggere, e la shell la dice all'apertura di un vault
  che non ha rilevamento;
- **non promettiamo di accorgercene *dopo*.** Non c'è una riconciliazione
  periodica e questa decisione non ne introduce una: sarebbe una promessa più
  grande di quella che il codice mantiene, e la strada onesta per riallineare un
  vault resta chiuderlo e riaprirlo.

## Trovato per strada

- **Chi smette lo dice, e ci vuole un `Drop`.** Un debouncer si ferma quando
  viene distrutto — è il modo in cui la
  [0029](0029-chiudere-un-vault-e-chiuderli-tutti.md) lo spegne, per prima cosa,
  chiudendo un vault. Senza abbassare la bandiera lì, sarebbe rimasta alzata su
  una sessione che non guarda più niente: la stessa bugia di prima, spostata di
  un momento.
- **La bandiera si alza DOPO che `watch` è riuscita.** Fra il debouncer
  costruito e la radice effettivamente osservata c'è un errore possibile, e in
  quella finestra la risposta giusta è ancora `false`. Alzarla alla costruzione
  sarebbe stato «per costruzione» un'altra volta, con un nome nuovo.
- **Un rename che fallisce contava due volte.** `sync_renamed_path` degrada a
  `sync_path` in due rami, e con la registrazione sulla porta pubblica un
  fallimento solo ne avrebbe contati due. I rami interni passano adesso dal
  corpo (`sync_path_here`), e la porta registra una volta. Ha un presidio
  proprio, perché è il genere di cosa che si riscrive per sbaglio.
- **`NoWatcher` non deve fare niente, ed è il punto.** Non alzare la bandiera è
  tutto il suo contributo — e questo trasforma «qui nessuno vede le scritture
  altrui» da proprietà del montaggio che nessuno scrive da nessuna parte in un
  fatto che si può chiedere.

## Cosa NON è stato fatto, e perché

- **Nessun watcher migliore, e nessuna riconciliazione periodica.** La voce
  chiedeva esplicitamente il contrario — «cosa serve, e non è un watcher
  migliore» — e la ragione tiene: un polling che confronti la cache col disco è
  una politica (ogni quanto, su che scala di vault, a che costo di batteria) e
  vuole i metadati di entry che il §14.2 non ha ancora (né mtime, né dimensione,
  né impronta). Confrontare senza impronte vorrebbe dire rileggere tutto, cioè
  reindicizzare a intervalli.
- **`write_document` continua a non avere una `base`, ed è il residuo
  nominato.** Il §9.7 lo chiamava «la conseguenza peggiore è una scrittura, non
  una lettura»: la [0008](0008-modifica-chirurgica.md) ha dato la guardia giusta
  — una revisione nella firma, e `Conflict` invece della sovrascrittura
  silenziosa — ma vale per `apply_edit`, cioè per i *provider*. Il salvataggio
  dell'editor passa da `write_document`, che una base non ce l'ha. Questa
  decisione non lo chiude e non lo può chiudere da sola: è il conflitto
  buffer↔disco esplicito del [§18.1](../roadmap/18-editor-e-tastiera.md), dove è
  stato scritto. Ciò che cambia è che adesso quel rischio è **misurabile** da
  chi disegna — con `watching: false` la copertura è nulla e si sa.
- **Nessun indicatore permanente nella shell.** Un vault senza rilevamento
  produce un avviso all'apertura (`notify`), che è ciò che questa shell può
  mostrare oggi senza inventarsi una superficie. L'indicatore che sta lì e resta
  vuole una barra di stato, che è §20.4 col §1.2: metterla qui vorrebbe dire
  decidere il layout di sfuggita.
- **`last_sync_error` è una stringa già composta, e non è un rimando.** Va con
  il §12.2: quando l'errore al confine avrà codice e parametri, l'avrà anche
  questo campo, e la migrazione è quella di tutti gli altri messaggi. Un campo
  strutturato inventato qui avrebbe deciso la forma dell'errore per tutto il
  contratto, con un cliente solo davanti.
- **Un errore solo, e non una lista.** L'ultimo è quello che serve a chi guarda
  («cosa è successo adesso»); una lista è un log, e un log ha una destinazione
  (§20.2) che non c'è ancora. Il contatore dice che ce ne sono stati altri, che
  è la parte che non si può ricostruire dopo.

## Verifica

- `cargo build --workspace` — pulita, zero warning; anche
  `-p fub-host --no-default-features`.
- `cargo clippy --workspace --all-targets` — pulita.
- `cargo test --workspace` — **58 suite, 0 fallimenti**. Sono le 57 della
  [0029](0029-chiudere-un-vault-e-chiuderli-tutti.md) più
  `fub-kernel/tests/rilevamento.rs`, che ha quattro prove: un vault senza
  rilevatore che lo dice, la bandiera che è una sola, un esito scartato dal
  chiamante che resta scritto (e un conto che non si azzera da solo), e il
  rename che conta una volta sola. In `fub-host/tests/headless.rs` c'è la
  quinta, che è quella che lega i due lati: `Host::is_watching` e
  `IndexQuery::VaultStatus` rispondono dallo stesso bit, e chiudere il vault lo
  abbassa.
- **Provate al contrario, tutte e due le righe che contano:**
  - togliendo la registrazione dentro `note_sync`, le due prove sugli esiti
    scartati falliscono con il proprio messaggio (`left: 0, right: 1`) — cioè il
    vault non si ricorda più di ciò che il chiamante ha buttato;
  - facendo rendere a `watch_flag` un `Arc` **nuovo** invece della bandiera del
    kernel, falliscono `la_bandiera_e_una_sola_e_la_tiene_chi_guarda` («la
    risposta segue la bandiera») e la prova dell'host («chi guarda ha alzato la
    bandiera del kernel, non una sua»). È la prova che due copie non passano.
- **Contratto:** `IndexQuery::VaultStatus`, `QueryKind::VaultStatus`,
  `IndexResult::VaultStatus(VaultStatus)` e il record `vault-status` sono **in
  coda** ai rispettivi variant, quindi additivi; presidiati da
  `wit_conformance`, che verifica anche l'ordine dei casi contro la
  dichiarazione Rust. Il mirror TS è rigenerato, con un campione che ha il
  rilevamento **acceso e già inciampato** — coi default il mirror non vedrebbe
  né un `true` né una stringa dentro l'opzione, cioè metà della forma.
- `cd frontend && npx vitest run` — 11 file, 173 test verdi; `npx tsc --noEmit`
  pulita.
- `cargo fmt --all` — pulita.
