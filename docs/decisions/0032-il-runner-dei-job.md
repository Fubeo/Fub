# 0032 — Il runner dei job: chi esegue, chi lo può fermare, e chi non si porta via il vault

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §9.3 (seduta 9) — **seconda metà**: chiude la voce e la seduta |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md)

---

È la seconda metà del §9.3, e chiude sia la voce sia la
[seduta 9](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md). La prima —
[0031](0031-chi-possiede-i-bundle.md) — ha messo un proprietario dietro ogni
plugin; qui si mette in moto ciò che quel proprietario custodisce, e si decide
cosa succede quando il lavoro va fermato o va storto.

Erano tre buchi, e stavano insieme per una ragione sola: **si aprono tutti nel
momento in cui il lavoro esce dal giro sincrono.**

- **La coda non la drenava nessuno.** `spawn_job` accodava, `complete_job`
  riconsegnava, il giro era coperto da un test — e in produzione non c'era **il
  chiamante**. Un job chiesto da una feature restava in coda finché il vault non
  chiudeva. Il pezzo mancante non era più il ponte: la
  [0027](0027-il-lavoro-lungo-vede-il-vault.md) aveva dato al job l'`HostApi` e
  al pool il `JobHost` da passargli, la [0031](0031-chi-possiede-i-bundle.md) gli
  aveva dato **a chi chiedere il corpo**. Mancava chi girasse la chiave.
- **Una coda non si ferma, si svuota.** Non esisteva niente per fermare un
  lavoro lungo, e la voce lo diceva col caso peggiore: «un job che non si può
  fermare è un job che blocca la chiusura dell'app» — chiusura che dalla
  [0029](0029-chiudere-un-vault-e-chiuderli-tutti.md) **esiste**, e che non
  aspettava nessuno solo perché non c'era nessuno in volo.
- **Un provider che pania si portava via il vault.** `view_action` e
  `invoke_command` girano sotto il prestito **esclusivo**, e `write_document` ci
  fa passare il parse del formato e l'alimentazione degli indici: da lì un panico
  avvelenava il `RwLock`, e i `.write().unwrap()` di chi monta lo traducevano in
  un panico su **ogni** comando successivo — il vault irraggiungibile fino al
  riavvio. La [0024](0024-chi-legge-non-aspetta-chi-legge.md) ne aveva tolto una
  metà (chi **disegna** gira sotto prestito condiviso, e un prestito condiviso
  non si avvelena); restava quella di chi **agisce**, che non è la metà meno
  probabile — con un'estensione installata, un handler di comando che pania è il
  caso normale.

## La risposta, in una frase

**Un pool di thread che aspetta un campanello del kernel invece di chiedere;
annullare un job è alzare una bandiera, e da lì in poi è il suo host a dirgli di
no; chi chiude aspetta chi ha già cominciato; e un panico — da qualunque
provider venga — costa la chiamata, non il vault.**

## Le decisioni prese, da NON ridiscutere senza motivo

### Il pool

- **N thread dedicati, non un worker solo e non un drenaggio sincrono.** Un
  worker solo vorrebbe dire che un job che aspetta la rete tiene fermo un job che
  calcola; un drenaggio sincrono — «ogni tanto, dentro un comando» — vorrebbe
  dire che il lavoro lungo gira nel giro che esiste per non farcelo girare.
- **Due, di default, e il numero è un default dichiarato.** Non uno, per la
  ragione appena detta. Non «quanti core»: il parallelismo utile non lo limitano
  i core, lo limita il `RwLock` del workspace — due job che scrivono si mettono
  in fila comunque ([0024](0024-chi-legge-non-aspetta-chi-legge.md)) — quindi un
  pool grande comprerebbe contesa, non velocità. Chi monta lo cambia
  (`Host::with_job_threads`), e il giorno che una misura dirà un altro numero
  sarà **quella** a dirlo, come per la [0026](0026-due-query-insieme.md).
- **Un pool per vault, non uno globale.** La coda è del workspace, e due vault
  non si conoscono: un pool condiviso farebbe sì che chiudere un vault fermi il
  lavoro dell'altro, o che il lavoro dell'altro tenga aperto questo.
- **Il pool aspetta un campanello, non chiede.** `JobBell` sta nel kernel e si
  **presta** a chi possiede i thread: è la stessa mossa della bandiera del
  rilevamento ([0030](0030-il-rilevamento-si-puo-chiedere.md)) — il kernel
  possiede un pezzetto di stato condiviso e lo dà a chi fa il mestiere che lui
  non fa. L'alternativa era interrogare la coda a intervalli, cioè scegliere una
  **politica** (ogni quanto? a che costo di batteria?) al posto di un fatto.
- **Il campanello conta, non accende.** `queued` è *quanti job sono stati
  accodati da sempre*: chi drena legge il conto **prima** di drenare e poi aspetta
  che cambi. Con un booleano, un job accodato nella finestra fra il drenaggio e
  l'attesa resterebbe fermo fino al successivo — il bug che si vede una volta al
  mese e non si riproduce mai.

### La cancellazione

- **Non aggiunge nessuna capacità, ne toglie.** Nel contratto non compare niente:
  nessun `is_cancelled()` che un job debba ricordarsi di chiamare, nessun token da
  passare in giro. C'è una bandiera che il runner alza, e da quel momento l'host
  del job **rifiuta** — `PluginError::Cancelled` alla capacità successiva. Un job
  scritto prima che la cancellazione esistesse si ferma comunque, alla prima cosa
  che prova a fare; e una capacità nuova sarebbe stata una cosa in più da
  ricordarsi, cioè una regola che si perde alla prima riga scritta di fretta.
- **Il limite è dichiarato: un job che non chiama mai l'host arriva in fondo.**
  Non c'è niente da rifiutargli, e in Rust un thread non si uccide. La
  cancellazione è cooperativa **perché non può essere altro**, e la risposta vera
  per il codice che non collabora arriva a M5, dove un componente WASM ha un
  deadline. Dirlo qui è la differenza fra un limite e una sorpresa: ha una prova
  sua, che verifica che quel job arrivi in fondo.
- **`Cancelled` è una variante nuova del contratto, e va aggiunta adesso.** È
  l'unico esito che **non è un difetto di nessuno**: un job fallito si riprova e
  si segnala, un job annullato ha fatto ciò che si voleva. Con `Internal`
  l'utente leggerebbe «errore interno del plugin» sotto un pulsante che ha appena
  premuto. È additiva (in coda al variant) e costa un campo oggi; dopo il freeze
  di M4 costerebbe una migrazione di versione, ed è il criterio che fa di questa
  mezza voce una P0.
- **Le capacità che non possono fallire non rifiutano**, e sono cinque:
  `free_name`, `format_of`, `now_unix_millis`, `active_context`, `emit`. Non
  hanno **dove** metterlo, un rifiuto. Nessuna delle cinque cambia il vault, e la
  ragione non è fortuna: nel contratto **tutto ciò che cambia il vault può
  fallire**, quindi tutto ciò che cambia il vault si può rifiutare. `emit` resta
  aperta di proposito — l'ultima cosa che un job annullato può voler dire è che
  sta smettendo.
- **Annullare un job che non è ancora partito vale quanto annullarne uno in
  volo**, e annullarne uno che non esiste non è un errore. La bandiera la crea
  chi arriva prima, il runner o chi annulla; rispondere «non lo conosco»
  farebbe di «annulla» una corsa che si perde proprio nel momento in cui la si
  vorrebbe vincere.

### La chiusura

- **Chi chiude aspetta chi ha già cominciato, dopo avergli detto di smettere.**
  L'ordine è quello della [0029](0029-chiudere-un-vault-e-chiuderli-tutti.md) con
  un gemello in mezzo: **prima si smette di guardare** (il watcher), **poi si
  smette di lavorare** (il pool), **poi si chiude**. Le prime due sono la stessa
  regola letta due volte — nessun altro thread deve poter entrare nel vault
  mentre lo si chiude — e non aspettare vorrebbe dire lasciare un job che scrive
  mentre gli indici si chiudono.
- **Ma non aspetta chi non è partito.** Il controllo di «sto chiudendo» sta
  **dentro** il ciclo dei job, non solo in cima: un drenaggio prende tutta la
  coda, e senza quella riga chiudere vorrebbe dire eseguire fino in fondo tutto
  ciò che un thread si è trovato in mano.
- **Nessun job sparisce in silenzio.** Chi non parte riceve comunque un
  `JobDone` con `Cancelled`: è la regola che la
  [0028](0028-come-un-componente-smette.md) ha già scritto per i job di chi si
  disattiva — un job che sparisce senza un esito è un chiamante che aspetta per
  sempre.

### Il safe mode

- **La rete sta attorno alla chiamata del provider, e a niente di più.** È la
  parte da non spostare "più in alto per comodità". Intorno a quella chiamata il
  kernel ha invarianti da rimettere a posto — la tabella dei provider prestata
  (`lend`), la pila dei comandi, quella dei servizi, la bandiera
  `in_provider_call`, l'attore, il lotto — e tutto quel codice gira già
  correttamente sul ramo dell'errore, perché era scritto per gestirlo. Catturare
  più in alto salterebbe quei ripristini: si sarebbe salvato il lock e perso il
  kernel, con la tabella delle view **vuota** o un comando per sempre "in giro" a
  rifiutarsi da sé.
- **Otto porte, e sono tutte quelle da cui si entra in codice di un plugin**:
  `invoke_command` (i due rami), `view_action`, `render_view`, `call_service`, la
  consegna a un `EventHandler`, l'alimentazione degli indici registrati, il
  `parse` di un `FormatProvider`, l'innesto di una `SyntaxRule` e il disegno di un
  `CustomRenderer`. Le ultime quattro sono dentro **ogni scrittura**, che è dove
  la voce diceva che il buco era rimasto aperto.
- **Un panico si traduce nell'errore di casa.** `PluginError::Internal` per chi
  parla quella lingua, `FormatError` per un provider di formato e per un
  renderer: così chi chiama lo tratta come tratta già il fallimento — il renderer
  che degradava al provider degrada anche qui, senza un ramo nuovo. E il
  messaggio **nomina** il colpevole: «qualcosa è andato storto» senza dire quale
  plugin è la stessa cosa che non dirlo.
- **L'indice del kernel non è in rete.** Se pania lui è un difetto del kernel, e
  nasconderlo vorrebbe dire cercarlo poi dentro un vault che risponde a metà.
- **Un panico non disattiva niente**, e la voce chiedeva il contrario
  («disattivazione con avviso»). Il **meccanismo** c'è dalla
  [0031](0031-chi-possiede-i-bundle.md) (`BundleRegistry::unmount`); ciò che non
  c'è è il resto della frase: non c'è un canale per dare l'**avviso** (§20.2) né
  un modo di **riaccendere** a runtime (§11.1). Spegnere senza poterlo dire né
  disfare trasformerebbe un difetto passeggero — un documento storto, un click
  strano — in un pannello che sparisce per il resto della sessione senza
  spiegazione. Un panico costa la chiamata; il giorno che le due voci ci sono, la
  politica si decide con loro davanti.
- **Il veleno del lock resta un segnale, e non lo si aggira.** I
  `.expect("workspace avvelenato")` restano dove sono: da questa decisione in poi
  un lock avvelenato vuol dire che a paniare è stato **il kernel**, non un
  plugin, e quello va visto, non ignorato.

## Trovato per strada

- **Il registry teneva un `Box`, adesso tiene un `Arc`, e la
  [0031](0031-chi-possiede-i-bundle.md) diceva `Box`.** Il runner esegue
  `run_job` su un thread suo e per tutta la durata del job: deve **tenere** il
  corpo senza tenere il lock del registry, o chiudere il vault aspetterebbe la
  fine di un export. `Arc<dyn Plugin>` regge perché `run_job` prende `&self`;
  `deactivate` prende `&mut self` e quindi vuole l'unicità — che c'è, perché chi
  chiude ferma il pool **prima**. E se un giorno qualcuno invertisse i due passi,
  quel commiato non verrebbe chiamato: il registry lo **dice** con un errore che
  nomina la causa, invece di aspettare in silenzio.
- **Il `pop` prima del `?` era già scritto giusto.** Le pile e le tabelle del
  kernel si svuotano sul ramo dell'errore perché quel codice era già scritto per
  l'errore: la rete messa al posto giusto non ha voluto **nessun** ripristino
  nuovo. Il presidio è il comando che si può richiamare dopo essere esploso — se
  la pila non si svuotasse, il secondo giro risponderebbe «un comando non può
  invocare sé stesso», che è il genere di bugia che si insegue per un pomeriggio.
- **Il parse viene prima della scrittura**, quindi un formato che pania non muove
  nemmeno il disco: la mutazione resta atomica anche quando a fallire è un
  panico. La riga era già lì per un parse *fallito*, e vale identica per uno
  esploso.
- **Una prova diceva l'opposto, ed è stata riscritta.** In `concorrenza.rs`,
  `una_view_che_pania_disegnando_non_avvelena_il_vault` affermava che «il panico
  attraversa ancora il chiamante»: era vero, ed era la metà che la 0024 poteva
  comprare da sola. Adesso non lo attraversa più. Ciò che la 0024 ha comprato
  resta e non è ridondante, e la prova lo dice: la rete si può bucare — quella
  prova la buca apposta — e sotto un `Mutex` un buco solo costerebbe ancora il
  vault.
- **`PluginError` non arriva al frontend come tipo.** Il mirror TS non lo
  contiene: gli errori attraversano l'IPC già composti in stringa. La variante
  nuova quindi non ha cambiato una riga del frontend — e questo è anche la misura
  di quanto il §12.2 (errori con codice e parametri) sia ancora tutto lì.

## Cosa NON è stato fatto, e perché

- **Nessun progresso, e nessun pulsante.** Un job non ha modo di dire «sono al
  40%», e chi guarda non ha dove vederlo: è il §10.3 con il §10.2, e il freno
  degli eventi va con lui — la voce dice già che il progresso «sarà il canale più
  caldo». `Host::cancel_job` è la porta a cui quel pulsante si attaccherà, e oggi
  la usano i presidi.
- **Nessuna priorità, nessuna quota, nessuna coda per plugin.** Un plugin che
  accoda mille job li fa eseguire tutti, in ordine di arrivo. Il tetto è §24.2, e
  sceglierlo qui vorrebbe dire inventare una politica senza un caso davanti — lo
  stesso motivo per cui il §14.2 non ha ancora le impronte.
- **Il numero dei thread non è misurato.** È un default con una ragione, non un
  risultato: il banco che lo misurerebbe è `examples/contesa.rs` col carico dei
  job, e la misura la si fa quando esiste un job vero che pesa (import, export,
  embedding).
- **Nessun riavvio automatico di un job**, e nessuna coda persistente: un job che
  non è partito perché il vault si chiudeva non riparte alla riapertura. Renderlo
  durevole vuol dire deciderne l'idempotenza, che è una proprietà di chi lo
  scrive e non dell'host.
- **`catch_unwind` presuppone che il panico srotoli.** Un profilo con
  `panic = "abort"` farebbe sparire questa rete in silenzio; il workspace non lo
  imposta, e se un giorno lo facesse questa è la riga da rileggere.
- **La 24.2 non è chiusa.** Qui c'è la rete al confine; l'isolamento vero — un
  plugin che non può portarsi via nemmeno la memoria — è la sandbox di M5, e
  l'avviso all'utente è il §20.2.

## Verifica

- `cargo build --workspace` — pulita, zero warning; anche
  `-p fubmd-host --no-default-features`.
- `cargo clippy --workspace --all-targets` — pulita.
- `cargo test --workspace` — **61 suite, 0 fallimenti**. Sono le 59 della
  [0031](0031-chi-possiede-i-bundle.md) più due:
  - `fubmd-host/tests/il_runner.rs` — cinque prove: un job accodato che parte da
    solo e scrive nel vault, un job annullato che riceve rifiuti alla chiamata
    successiva (e la prima scrittura che resta fatta, perché annullare non è
    disfare), il job puro che arriva in fondo comunque, il job che pania senza
    portarsi via il pool né il vault, e la chiusura che ferma tutto senza che
    nessun job sparisca in silenzio. Le prove non dormono: usano una barriera a
    due tempi, perché un test che aspetta un tempo fisso prova la macchina su cui
    gira;
  - `fubmd-kernel/tests/il_panico.rs` — cinque prove, una per specie: un comando
    (e la seconda metà che conta, che si può **richiamare**), una view che pania
    *agendo* senza svuotare la tabella prestata, un handler che non ferma la
    scrittura che lo ha svegliato, un indice che continua a essere interpellato
    dopo essere esploso, e un formato che pania senza muovere il disco.
- **Provate al contrario, tutte e cinque le righe che contano:**
  - togliendo la rete attorno a `run_job`, il thread del pool muore col job e
    `un_job_che_pania_costa_il_job_e_non_il_pool` fallisce con «nessun job è mai
    tornato: la coda non la drena nessuno»;
  - togliendo il controllo della bandiera in `JobHost`, il job annullato arriva
    in fondo e la prova lo mostra (`Ok(String("due"))` invece di `Cancelled`), e
    con lei fallisce anche quella della chiusura;
  - togliendo la rete al gate dei comandi, il panico del comando attraversa e la
    prova muore sul panico stesso;
  - spostando la rete **fuori** dal `lend` della `view_action`, la tabella delle
    view non torna al suo posto e la prova lo dice: il vault resta senza
    **nessuna** view, non solo senza quella esplosa;
  - togliendo il `ring()` da `enqueue_job`, tutte e cinque le prove del runner
    falliscono: i job restano in coda e nessuno si sveglia. È la prova che il
    campanello non è decorativo.
- **Contratto:** `PluginError::Cancelled` / `cancelled(string)` è **in coda** al
  variant, quindi additiva; `wit_conformance` (che verifica anche l'ordine dei
  casi contro la dichiarazione Rust) e `wit_additivity` (contro
  `crates/fubmd-abi/wit/frozen/0.1.0.wit`) sono verdi.
- **Mirror TS invariato**: `UPDATE_MIRROR=1` su `ts_mirror_app` e `ts_mirror` non
  produce nessuna differenza — `PluginError` non attraversa l'IPC come tipo.
  `cd frontend && npx vitest run` (11 file, 173 test) e `npx tsc --noEmit`:
  puliti.
- `cargo fmt --all` — pulita.
