# 0035 — Il lavoro lungo si racconta: chi guarda, cosa vede, e chi mette il nome sul progresso

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §10.3 (seduta 10) — **chiude la voce e la [seduta 10](../roadmap/10-gli-eventi.md)** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/10-gli-eventi.md) · le sorelle:
[0033](0033-la-grana-di-un-abbonamento.md),
[0034](0034-il-freno-e-il-raggruppamento.md)

---

La terza distanza dello stesso canale: **chi lo mostra all'utente**. Le altre
due — chi si abbona ([0033](0033-la-grana-di-un-abbonamento.md)) e cosa passa il
ponte ([0034](0034-il-freno-e-il-raggruppamento.md)) — erano il canale visto da
dentro; questa è l'unico punto della seduta in cui c'è una persona che guarda.

Il lavoro lungo aveva tutto tranne quel punto. Un job si chiede
([0027](0027-il-lavoro-lungo-vede-il-vault.md)), qualcuno lo esegue
([0032](0032-il-runner-dei-job.md)), si può fermare — `Host::cancel_job`
esisteva e lo usavano **solo i presidi** — e nessuno di questi fatti aveva un
modo di arrivare allo schermo. Per l'utente un export di duemila note era
indistinguibile da un'app ferma.

E in mezzo c'era un nodo che la [0034](0034-il-freno-e-il-raggruppamento.md)
aveva lasciato sciolto a metà, dopo averne tagliato la propria: **un job non
conosce il proprio `JobId`**. `Plugin::run_job` riceve il nome dell'entry point,
gli argomenti e l'host, non l'identità — quindi non può emettere un evento che
lo nomini. Per la regola della [0013](0013-elenco-delle-capacita.md) il
progresso è un **evento** (si limita a informare); ma l'unico che può emetterlo
con l'id giusto è l'host del job, cioè un `report_progress` che sarebbe una
**capacità**.

## La risposta, in una frase

**Il progresso resta un evento e guadagna una porta, perché `emit` è già una
porta e nessuno la chiama una violazione; l'identità la timbra chi ce l'ha —
l'host del job — e siccome l'id non è un parametro, nessuno può raccontare il
progresso di un altro; il ciclo di un job diventa visibile per intero, e ciò che
si vede si può sempre richiedere, che è la condizione perché il canale più fitto
del contratto sia frenabile come tutti gli altri.**

## Le decisioni prese, da NON ridiscutere senza motivo

### Il progresso: un evento, una porta, un timbro

- **La tensione fra «evento» e «capacità» era mal posta, e si scioglie guardando
  `emit`.** La regola della [0013](0013-elenco-delle-capacita.md) classifica
  *cosa* va sul canale e cosa va nell'`HostApi`: «una capacità è ciò di cui il
  chiamante ha bisogno della risposta per proseguire; ciò che si limita a
  informare è un evento». Ma il modo di **consegnare** un evento è già una
  capacità — `HostEvents::emit` — e nessuno ha mai considerato quel metodo una
  contraddizione. `report_progress` è la stessa cosa con un argomento in meno:
  ciò che finisce sul bus è `Event::JobProgress`, e la funzione è la porta.
- **L'id non è un parametro, ed è la proprietà che vale la firma.**
  `report_progress(progress)` non nomina nessuno: il nome lo mette il `JobHost`,
  che l'ha ricevuto dal runner insieme alla bandiera dell'annullamento. Un job
  quindi non può sbagliare il proprio id, e **non può fingere quello di un
  altro** — la stessa proprietà per cui un topic di custom non si emette sotto
  il nome altrui (§7.4), ottenuta però senza controlli: non c'è niente da
  controllare.
- **Le due cose che un job non sa di sé sono la stessa mossa nei due versi.** La
  cancellazione arriva al job perché il suo host **smette di servirlo**
  ([0032](0032-il-runner-dei-job.md)); il progresso esce dal job perché il suo
  host **lo firma**. Quando smettere e come si chiama le sa chi lo esegue, e in
  tutti e due i casi il contratto non chiede al job di ricordarsi niente.
- **Fuori da un job la porta non fa niente, e non è una dimenticanza.** Il
  default di `report_progress` è un no-op, che eredita ogni host che non sia
  quello di un job. Un progresso ha bisogno di una **fine** per essere un
  progresso, e l'unica cosa che nel contratto ha una fine dichiarata è un job
  (`job-done`); una chiamata sincrona finisce tornando, e mentre gira tiene il
  prestito esclusivo del workspace — chi vuole raccontarsi mentre lavora, per
  costruzione, **è** un job. Il silenzio è la stessa risposta che `emit` dà a un
  host che non concede eventi.
- **Non si nega a un job annullato**, come `emit`: l'ultima cosa che un job che
  sta smettendo può voler dire è a che punto era arrivato. Le capacità che non
  possono fallire diventano sei.
- **`JobProgress` è un record solo per tutti e due i modi di sapere a che punto
  è un job** — l'evento e la risposta alla query. Due definizioni di «progresso»
  sarebbero due idee di cosa mostrare, e la seconda si accorgerebbe di essere
  diversa dalla prima solo davanti all'utente. `total` opzionale perché
  l'indeterminato è un caso vero (uno scaricamento senza `content-length`), e
  chi disegna deve poter mostrare un'attesa invece di una barra che mente.

### Il ciclo di un job, tutto sul canale

- **Tre eventi, e «accettato» non è «partito».** `job-started` lo emette il
  kernel quando il job entra in coda, non quando un thread lo prende in mano:
  quando parta davvero lo sa solo chi possiede i thread, e la differenza non
  cambia niente né per chi guarda né per chi ferma — un job in coda si annulla
  come uno in volo ([0032](0032-il-runner-dei-job.md)). Aspettare l'avvio vero
  avrebbe reso invisibili, e non fermabili, proprio i job che stanno aspettando.
- **L'origine dice chi ha chiesto, e per questo non c'è un campo.**
  `job-started` esce dal giro di chi ha chiamato `spawn_job`, quindi porta il
  suo attore; `job-done` resta del kernel, perché il job lo ha eseguito lui e
  chi lo ha chiesto si riconosce dall'`id` (era già così). Un `job-progress`
  porta invece il **plugin di cui il job è**: è il racconto che il lavoro fa di
  sé.
- **I due eventi nuovi sono recuperabili, e la query è ciò che li rende tali.**
  `IndexQuery::Jobs` risponde «cosa sta girando adesso», e senza di essa
  `is_recoverable` non avrebbe potuto dire `true`: buttare un avvio o un
  progresso sarebbe stata una perdita definitiva — una riga ferma per sempre su
  un lavoro finito. Con essa, i due freni della
  [0034](0034-il-freno-e-il-raggruppamento.md) possono sacrificarli come
  sacrificano un `document-changed`, e chi riceve l'`overflow` richiede
  l'elenco. Il canale più fitto che il contratto avrà è così l'unico che *non*
  ha avuto bisogno di un meccanismo suo.
- **`job-done` resta non recuperabile**, ed è esattamente il confine giusto: ciò
  che la query sa ricostruire sono i job **vivi**, e un job finito dalla tabella
  è uscito. L'esito lo aspetta chi lo ha chiesto, e nessuno lo ricostruisce.
- **La query è del kernel**, come `vault-status` (§9.7,
  [0030](0030-il-rilevamento-si-puo-chiedere.md)) e per la stessa ragione: la
  coda dei job è sua — conta gli id, li accetta, li chiude — mentre chi possiede
  i thread sa solo quelli che gli sono già entrati in mano. La tabella vive
  dentro `CoreIndex` perché *le risposte del kernel sono un provider*
  ([0019](0019-il-canale-dati.md)): metterla sul workspace avrebbe voluto dire
  intercettare una variante prima del router, cioè rimettere il ramo
  privilegiato che quella decisione ha tolto.
- **La riga esce dalla tabella prima che l'esito parta.** Altrimenti chi riceve
  `job-done` e ricontrolla l'elenco — che è esattamente ciò che un centro
  attività prudente fa — troverebbe ancora là dentro il lavoro che gli è appena
  stato detto finito.

### Il centro attività

- **Due strade per la stessa verità, e non sono un doppione.** Le righe le
  muovono gli **eventi** (costa niente, arriva subito); la **query** serve
  quando il filo si è interrotto — all'apertura del pannello, all'apertura del
  vault (job partiti prima che questa finestra esistesse), e dopo un `overflow`,
  che nel contratto vuol dire precisamente *richiedi*.
- **Un progresso per un lavoro che non conosciamo non inventa una riga**: chiede
  l'elenco. L'evento non porta il nome del job — inventarne uno («lavoro 7»)
  sarebbe una riga che mente — e il caso non è teorico, è esattamente ciò che i
  freni del canale rendono possibile.
- **Annullare non toglie la riga.** La toglie il `job-done` che arriva, perché
  un lavoro annullato ha comunque un esito ([0032](0032-il-runner-dei-job.md)):
  toglierla subito racconterebbe che si è fermato, mentre si sta fermando — e un
  job puro che non chiama mai l'host non si ferma affatto, che è il limite
  dichiarato di quella decisione.
- **Una query che fallisce lascia l'elenco com'era.** Un centro attività vuoto
  per un errore direbbe «non sta girando niente», che è la bugia peggiore che
  questo pannello possa dire.
- **La barra senza valore è l'attesa che non sa quanto dura**: `total: null` si
  disegna come un `<progress>` indeterminato, non come una barra a metà.

### Il centro notifiche

- **Questa voce non è la superficie: è la sua forma bella**, e la distinzione
  regge ancora. Che un posto *esista* è il §20.4 (**P1**, ancora aperta): lì
  stanno i quattordici `console.warn`/`console.error` da portare a galla e lo
  stato di salvataggio. Qui c'è ciò che quel posto deve essere quando ci
  arriveranno: **uno storico**, un **raggruppamento** e un **tono**.
- **Uno storico, perché un toast che scompare è un canale che perde.** Quattro
  secondi e il messaggio dopo che cancella il precedente bastavano con tre
  chiamanti; con quattordici, «segnalato» e «detto a nessuno» tornano a essere
  la stessa cosa — che è la frase con cui il §20.4 descrive lo stato attuale.
- **Si raggruppa ciò che è identico *di fila*, e non ciò che è identico.**
  Raggruppare due messaggi uguali lontani nel tempo racconterebbe che è successo
  una volta sola; raggrupparne dieci consecutivi dice ciò che sta succedendo
  *adesso*, che è l'unica cosa che dieci copie aggiungono.
- **Due toni e non cinque.** Chi guarda deve distinguerli a colpo d'occhio, e
  una scala di severità che nessuno sa dove tagliare finisce con tutto sullo
  stesso gradino.
- **L'esito di un lavoro lungo si annuncia sempre, riuscito o no.** La riga che
  sparisce non è un messaggio: chi ha chiesto un export e ha guardato altrove
  non avrebbe modo di sapere che è finito, né tantomeno che non è finito. Un job
  nasce sempre da qualcosa che l'utente ha chiesto, quindi non c'è (ancora) la
  famiglia dei job silenziosi per cui questa regola sarebbe rumore.
- **La sorgente non è ancora un evento del contratto, e va detto.** La
  [0013](0013-elenco-delle-capacita.md) ha deciso che `notify` sarà una variante
  di `Event`; il cliente lo porta il §20.2 insieme al tipo dell'errore (§12.2).
  Da questa parte il canale è pronto: `notify` è una funzione sola, e il giorno
  che la variante arriva le si attacca il router degli eventi invece di venti
  chiamanti.

### Il pulsante che ferma

- **`cancel_job` diventa un comando IPC**, che è l'unica cosa che mancava:
  l'`Host` sapeva già annullare e nessuno gliela chiedeva se non i presidi.
- **L'id attraversa il confine come stringa**, per la regola di `fub_abi::ipc`:
  è un u64 pieno, e `JSON.parse` perde i bit oltre 2⁵³ in silenzio. Un job che
  ogni tanto non si annulla somiglierebbe a un job lento.
- **Non c'è un «job sconosciuto»**: è la [0032](0032-il-runner-dei-job.md), e
  qui se ne vede il motivo — un pulsante premuto un istante dopo che il lavoro è
  finito è il caso *normale*, non un errore da mostrare.

## Trovato per strada

- **Un `JobId` non si ordina, e la tabella lo ha dovuto dire.** Il contratto lo
  dichiara opaco; chi può assumere che i numeri crescano è solo chi li assegna,
  cioè il kernel. La tabella dei job vivi è quindi indicizzata sul **numero
  dentro** l'id, non sull'id — è la stessa disciplina che il runner applicava
  già confrontando `id.0` a mano — e ne esce l'elenco nell'ordine in cui il
  lavoro è stato chiesto, che è l'unico che chi guarda riconosce.
- **Il progresso di un job già finito non deve far ricomparire la riga.** Fra
  l'ultimo passo di un job e il suo esito c'è una finestra vera: sono due
  thread. `note_job_progress` registra ed emette **solo** se il job è ancora
  vivo, e la risposta di quel controllo è il valore di ritorno del metodo della
  tabella — non un `if` scritto due volte.
- **Il ponte aveva già il posto giusto.** Il raggruppamento della
  [0034](0034-il-freno-e-il-raggruppamento.md) ha accolto il progresso con **una
  grana in più** (`Grain::Progress(id)`), e nient'altro: mille passi di due job
  diventano due consegne, l'ultima di ciascuno. La chiave è l'id, o due job che
  camminano insieme si mangerebbero i passi a vicenda. È il canale più caldo che
  ci sarà, e non ha voluto una riga di meccanismo suo — che era esattamente ciò
  che quella decisione aveva promesso.
- **Un banco a barriere si guarda dentro il ciclo e si giudica fuori.** Il test
  del ciclo di vita osserva il job mentre è fermo alla barriera: se lì dentro
  cade un'asserzione, il thread del pool resta in attesa di un via che nessuno
  darà più, e chi chiude lo aspetta — la suite si pianta invece di diventare
  rossa. Le osservazioni si accumulano nel ciclo e si giudicano dopo, ed è una
  regola del banco, non una preferenza: la si è scoperta provando al contrario.

## Cosa NON è stato fatto, e perché

- **Il §20.4 resta aperto, e resta P1.** Portare qui i quattordici avvisi che
  oggi finiscono in `console` e dare uno stato al salvataggio è quella voce, non
  questa: qui c'è il posto dove atterrano. L'ordine fra le due — «non vanno
  unite, ma nemmeno prese nell'ordine sbagliato» — è rispettato al contrario di
  come la roadmap se lo aspettava, e va detto: la superficie minima esisteva già
  (`notify`), quindi questa voce ha potuto farla bella senza aspettare che
  l'altra la riempisse.
- **Nessuna variante `Event::Notified`.** Sarebbe il §20.2, e il suo payload è
  lo stesso tipo del §12.2 (errori tipizzati al confine, **P0**): aggiungerla
  adesso vorrebbe dire scegliere la forma dell'errore in una voce che non è
  quella, e rifarla al freeze.
- **Il kernel non racconta il proprio lavoro lungo.** `reindex` cammina il vault
  intero e non emette progresso, ed è coerente con la regola scelta: gira dentro
  il prestito esclusivo, cioè in un momento in cui nessuno può disegnare. Il
  giorno che l'apertura del vault diventerà incrementale (§15.7) quella sarà una
  domanda vera, e la porta c'è già.
- **Il centro attività non tiene lo storico dei lavori finiti.** Chi vuole
  sapere com'è andata legge l'avviso; una seconda cronologia, con una seconda
  politica di quanto conservare, sarebbe lo stesso elenco raccontato due volte.
- **Nessuna misura, e due default con una ragione.** Cinquanta avvisi ricordati
  e cinque secondi di toast sono scelte, non risultati — come i due thread del
  pool ([0032](0032-il-runner-dei-job.md)): il giorno che una misura o un uso
  vero diranno un altro numero, saranno quelli a dirlo.
- **Il progresso non è persistito e non si annulla in blocco.** Chiudere il
  vault ferma tutto ([0029](0029-chiudere-un-vault-e-chiuderli-tutti.md)); un
  «annulla tutto» dalla UI sarebbe un pulsante che fa una cosa sola in un posto
  in cui le righe sono già tutte visibili.
- **`report_progress` non è tarata.** Un job che la chiama per ogni byte fa un
  giro di lock per byte: il freno c'è dalla parte di chi consegna (il ponte ne
  tiene l'ultimo), non dalla parte di chi chiama. È il prezzo della semplicità,
  ed è dichiarato — la stessa forma della
  [0027](0027-il-lavoro-lungo-vede-il-vault.md), che paga un lock per capacità.

## Verifica

- `cargo build --workspace --all-targets`,
  `cargo clippy --workspace --all-targets` e
  `cargo clippy -p fub-host --no-default-features` — pulite, zero warning;
  `cargo fmt --all` pulita.
- `cargo test --workspace` — **64 suite, 0 fallimenti**; `npx tsc --noEmit`,
  `npm run build` e `npx vitest run` (**196 prove**) verdi.
- Le prove nuove:
  - `fub-host/tests/il_runner.rs` — il giro intero visto da chi guarda: la riga
    compare all'accettazione, i tre passi si vedono **chiedendo** l'elenco
    mentre il job è fermo alla barriera, e a esito arrivato l'elenco è vuoto;
    più il caso del progresso fuori da un job, che non fa comparire niente;
  - `fub-host/src/bridge.rs` — mille passi di due job che diventano due
    consegne, con l'ultimo di ciascuno e senza che i due si mescolino;
  - `fub-abi/src/event.rs` — i due eventi nuovi dentro `EventMask::all` e dalla
    parte giusta di `is_recoverable`;
  - `frontend/src/panels/activity.test.ts` — le otto regole dell'elenco, fra cui
    le due che si vedono solo sotto carico: il progresso orfano e l'`overflow`
    che fanno **richiedere** invece di svuotare;
  - `frontend/src/ui/notify.test.ts` — il raggruppamento di fila, quello che non
    deve avvenire, i toni che non si fondono, e il taglio della memoria.
- **Provate al contrario, tutte e quattro le righe che contano:**
  - togliendo `.for_job(job.id)` dal runner, il progresso non ha più chi lo
    firmi e `un_job_che_cammina…` fallisce;
  - togliendo `jobs.finished(id)` da `complete_job`, l'elenco non si svuota più
    e lo stesso test fallisce sull'ultima asserzione;
  - togliendo `Grain::Progress`,
    `a_job_walking_says_where_it_got_to_not_every_step` fallisce con mille
    consegne invece di due;
  - raggruppando gli avvisi identici **ovunque** invece che di fila,
    `non raggruppa due volte lontane` fallisce; e facendo tornare
    `riconcilia: false` sul progresso orfano fallisce la prova che lo copre.
- **Contratto: additivo.** `wit_conformance` e `wit_additivity` verdi — due casi
  in coda a `event` e a `event-kind`, uno in coda a `index-query`, `query-kind`
  e `index-result`, due record nuovi (`job-progress`, `job-status`) e una
  funzione nuova su `host-events`. Niente si è spostato.
