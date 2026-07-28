# 0034 — Il freno e il raggruppamento: il tetto sta con chi ritira, la finestra è la velocità di chi consuma

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §10.2 (seduta 10) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/10-gli-eventi.md) · la gemella: [0033](0033-la-grana-di-un-abbonamento.md)

---

Il canale verso chi sta **fuori** dal giro sincrono non aveva nessuna politica,
e i due difetti erano ai due capi:

- **Il bus non aveva un tetto.** `EventBus` usa canali `std::mpsc` illimitati, e
  un subscriber lento non rallentava nessuno: accumulava memoria, in silenzio.
  Era l'opposto esatto del `DISPATCH_BUDGET` che protegge gli handler — dove il
  troncamento c'è, ed è rumoroso.
- **Il ponte consegnava un messaggio IPC per evento**, da un thread che faceva
  `recv()` e `emit` in un ciclo senza freno. La [0011](0011-il-lotto.md) aveva
  già tolto i *ridisegni* — dentro un lotto arriva un `batch-ended` solo — ma
  non i **messaggi**: una rinomina con 200 backlink li faceva attraversare tutti
  e 200, uno per uno, e a ognuno la shell rifaceva `list_documents` e ridisegnava
  ogni view iscritta.

## La risposta, in una frase

**I canali restano illimitati perché il kernel non deve mai aspettare il
webview; il tetto sta col conto degli arretrati di chi ritira; la finestra del
raggruppamento non è un numero di millisecondi ma la velocità di chi consuma; e
ciò che si butta è solo ciò che si riscopre riguardando il vault.**

## Le decisioni prese, da NON ridiscutere senza motivo

### Il tetto del bus

- **I canali restano illimitati, ed è la riga da non "sistemare".** Un
  `sync_channel` metterebbe il freno sul **mittente**, e il mittente è il kernel
  mentre tiene il prestito esclusivo del workspace
  ([0024](0024-chi-legge-non-aspetta-chi-legge.md)): un webview occupato
  fermerebbe la scrittura, cioè l'app. Il freno sta quindi sul conto degli
  **arretrati** di ogni subscriber — quanti notice gli sono stati accodati e non
  ancora ritirati — che è un'informazione che non costa niente a chi emette.
- **Sopra il tetto si butta soltanto ciò che si riscopre riguardando il vault.**
  Chi è indietro di mille eventi non ha bisogno di rincorrerli: ha bisogno di
  **riconciliare**, che è ciò che un `Event::Overflow` dice già — lo dice agli
  handler quando il budget del dispatch si esaurisce, e la shell lo sa già
  leggere. Non c'è nessun meccanismo nuovo: c'è un secondo posto da cui il
  troncamento che già esisteva può nascere.
- **Ciò che non si riscopre passa comunque, anche sopra il tetto.** L'esito di un
  job lo sta aspettando chi lo ha chiesto, il payload di un custom non lo
  ricostruisce nessuno, `vault-opened` e `vault-closed` non si deducono da com'è
  fatto il vault, e un `overflow` buttato via è precisamente il messaggio che
  stava dicendo di aver buttato via qualcosa. Ne segue un **limite dichiarato**:
  un subscriber che non ritira mai fa crescere la memoria quanto il traffico non
  recuperabile che gli arriva. È traffico raro; il caso per cui il tetto esiste
  — la scansione di un vault grande, una sincronizzazione che tocca mille note —
  è tutto dall'altra parte.
- **La classificazione sta nel contratto, non nei due freni.**
  `Event::is_recoverable()` è in `fubmd-abi` accanto agli eventi: i freni sono
  **due** (il tetto del bus e il tetto della raffica), e una seconda idea di cosa
  sia sacrificabile sarebbe un evento perso in silenzio da uno dei due. Ogni
  variante nuova del contratto deve rispondere a quella domanda, e il `match`
  senza `_` fa in modo che debba.
- **Il debito lo riscuote chi arriva primo, e una volta sola.** Il conto dei
  buttati è condiviso fra chi emette e chi ritira: lo trasforma in `Overflow`
  chi emette — mettendolo **davanti** al fatto nuovo, che è l'ordine in cui le
  due cose sono successe — oppure chi ritira, trovando la coda vuota. Uno
  `swap` atomico fa sì che a riscuoterlo sia uno solo. Solo dal lato di chi
  emette non sarebbe bastato: in un vault che si ferma subito dopo, il conto
  resterebbe da dire per sempre.
- **`subscribe()` non rende più un `Receiver` nudo.** Il conto va **sottratto**
  quando un notice viene ritirato, e nessun `Receiver` lo farebbe da sé. La
  `Subscription` ha le tre porte di `std` (`recv`, `try_recv`, `recv_timeout`)
  più `try_iter`, e si comporta allo stesso modo: i chiamanti non hanno cambiato
  una riga, solo il tipo.

### Il raggruppamento del ponte

- **Nessuna finestra temporale, e questa è la decisione da non rovesciare per
  comodità.** Aspettare *n* millisecondi prima di consegnare vuol dire scegliere
  un numero — quanto? con che costo per il primo evento, che è quasi sempre
  solo? — e pagarlo su **ogni** evento, anche quando non c'è niente da
  raggruppare. Il ciclo invece aspetta il primo notice e poi **drena ciò che
  trova già in coda**: a vault fermo la raffica è di uno e la latenza è zero; se
  il kernel corre più veloce del webview, la raffica è grande esattamente quanto
  il ritardo, che è dove il raggruppamento serve. È auto-regolato per
  costruzione, e non c'è nessuna costante da indovinare.
- **Si tiene l'ultima occorrenza, non la prima.** `changed(a)`, `removed(a)`,
  `changed(a)` è una nota riscritta, cancellata e ricreata: tenere la prima la
  racconterebbe al contrario — chi riceve rileggerebbe *prima* di sapere che il
  file era sparito. Tenere l'ultima e conservare l'**ordine relativo** di ciò che
  resta racconta la stessa storia con meno parole. Vale anche per l'origine: fra
  l'eco di un salvataggio della shell e la scrittura di un plugin, l'ultima è
  quella che dice com'è il documento adesso.
- **Solo tre specie si raggruppano**, e nessuna delle tre porta un fatto che le
  altre copie non portino: `index-updated` (che non ha payload affatto),
  `document-changed` (che dice «rileggi questo») e `view-invalidated` (che dice
  «ridisegna questa»). Rimozioni, rename, lotti, custom ed esiti di job restano
  uno per uno: sono **fatti distinti**, e fonderli vorrebbe dire raccontare una
  storia diversa da quella che è successa.
- **L'unica assorbenza è quella che il contratto dichiara**: un
  `view-invalidated` senza istanza vuol dire *tutte* le istanze di quella view,
  quindi quelli che ne nominano una sola, nella stessa raffica, sono già
  compresi.

### Il tetto della raffica

- **È un'altra cosa dal tetto del bus, e sta molto più in basso.** Quello
  protegge la **memoria** di chi è indietro (mille); questo protegge il
  **canale** (centoventotto), e misura quante consegne separate valga la pena di
  fare. Mille documenti *diversi* non si raggruppano — sono mille fatti — ma
  consegnarli uno per uno costa a chi riceve mille giri completi, che è più
  lavoro della riconciliazione che li sostituisce tutti.
- **L'`Overflow` va dove stava l'ultimo evento che sostituisce**, non in coda e
  non in testa: è l'unico punto in cui dice la verità sull'ordine. In coda
  direbbe a chi ha appena ricevuto un `vault-closed` di andare a rileggere un
  vault che non c'è più.
- **Due inviti a riconciliare di fila sono uno.** Se nella raffica c'era già un
  `Overflow` — dal tetto del bus, o dal budget del dispatch — il suo conto si
  **somma** invece di aggiungere un secondo invito.
- **Il ponte è un modulo suo** (`fubmd-host/src/bridge.rs`), e la riga che decide
  *quando* accenderlo è rimasta in `Host::open`: quel momento — dopo la
  scansione, prima che il rilevatore possa emettere — lo conosce solo chi apre, e
  non è una politica del ponte. Il `EventSink` non è cambiato: resta un notice
  per chiamata, e chi lo implementa non sa che esiste un freno.

## Trovato per strada

- **Le prove del ponte non dormono, e non potevano.** Il raggruppamento è
  opportunista per costruzione — raggruppa ciò che trova già in coda — quindi
  «quanti messaggi passano» dipende da chi corre più veloce, e un test che
  aspettasse un tempo fisso proverebbe la macchina su cui gira. La raffica si
  costruisce invece con una **barriera a due tempi** (la stessa mossa della
  [0032](0032-il-runner-dei-job.md)): il sink si blocca sul primo evento, il
  test ne accoda mille sapendo che nessuno li ritira, e poi lo libera. Da quel
  momento il ponte trova mille eventi in coda **per forza**, e ciò che consegna è
  la politica, non la fortuna.
- **La politica si prova due volte, e va bene così.** In `bridge.rs` è una
  funzione pura e si prova senza thread (che è dove stanno l'ordine, le
  assorbenze, i casi limite); in `tests/il_ponte.rs` si prova che il ponte
  **vero**, col suo thread e la sua coda, faccia la stessa cosa. La prima
  sarebbe stata verde anche con il thread scollegato.
- **Il conto degli arretrati doveva essere un conto, non un booleano.** È la
  stessa scoperta del campanello dei job ([0032](0032-il-runner-dei-job.md)):
  con un booleano «ha traboccato» non ci sarebbe stato modo di dire *quanti*, e
  soprattutto non ci sarebbe stato modo di smettere di essere in debito quando
  chi ritira si mette in pari.

## Cosa NON è stato fatto, e perché

- **Il progresso dei job — e adesso si sa di chi è.** Era il terzo punto della
  voce («va con il lavoro lungo, che emetterà progresso») e restava un rimando
  circolare: il §10.2 lo mandava al §10.3 e il §10.3 lo rimandava qui. La
  circolarità si taglia dalla parte del contratto, e qui c'è la scoperta che
  serviva: **un job non conosce il proprio `JobId`**. `Plugin::run_job` riceve la
  `JobSpec` e l'host, non l'identità — quindi non può emettere un evento che lo
  nomini, e chi l'identità ce l'ha è il **suo host**. Per la regola della
  [0013](0013-elenco-delle-capacita.md) il progresso è un evento e non una
  capacità (si limita a informare); ma l'unico che può emetterlo con l'id giusto
  è l'host del job, cioè un `report_progress` che sarebbe una capacità. Quella
  tensione si scioglie col centro attività davanti — chi guarda, cosa vede, cosa
  può fermare — e quello è il §10.3. Il ponte, che era l'altra metà del rimando
  («e questo ponte non avrebbe come reggerlo»), adesso lo regge: il progresso è
  il canale più caldo che ci sarà, e un canale più caldo di così è già frenato.
- **Nessuna memoria fra una raffica e l'altra.** Il raggruppamento vive dentro un
  giro del ciclo, e non tiene traccia di ciò che ha già consegnato. Ricordarlo
  vorrebbe dire decidere per quanto — cioè scegliere quella finestra temporale
  che questa decisione non ha voluto — e comprerebbe qualcosa solo per un
  consumatore che è veloce e vorrebbe essere lento, che non è nessuno.
- **I due tetti non sono misurati.** Sono default con una ragione, non risultati:
  come i due thread del pool ([0032](0032-il-runner-dei-job.md)), il giorno che
  una misura dirà un altro numero sarà **quella** a dirlo. Il banco che li
  misurerebbe è `examples/contesa.rs` con un carico che tocchi molte note.
- **Il ponte non riordina e non ritarda niente**: consegna nell'ordine in cui le
  cose sono successe, tolto ciò che era detto due volte. Un ponte che
  riordinasse per priorità sarebbe un ponte che decide cosa è importante, e
  quello è di chi guarda.
- **`EventSink` resta uno-per-notice.** Un `emit_batch` avrebbe fatto risparmiare
  qualche attraversamento in più, e avrebbe chiesto a **ogni** implementazione —
  webview, CLI, SSE — di sapere cosa fare di un lotto di eventi. Il risparmio
  vero è già stato fatto prima, togliendo i messaggi.
- **Il tetto del bus non è una maschera.** Chi si abbona prende tutto ciò che il
  contratto emette: restringere per specie è della [0033](0033-la-grana-di-un-abbonamento.md),
  e vale per gli handler e per la shell, non per il canale.

## Verifica

- `cargo build --workspace` e `cargo clippy --workspace --all-targets` — pulite,
  zero warning; anche `-p fubmd-host --no-default-features`.
- `cargo test --workspace` — **64 suite, 0 fallimenti**. Le nuove di questa metà:
  - `fubmd-kernel/src/bus.rs` — quattro prove: la consegna con l'origine (c'era),
    il subscriber che non ritira mai e **smette di crescere** col conto dei persi
    che quadra col totale, l'esito di un job che passa il tetto comunque, e chi
    si rimette in pari che torna a ricevere tutto;
  - `fubmd-host/src/bridge.rs` — sei prove sulla politica pura: cento copie che
    diventano una, l'ultima occorrenza che vince, l'assorbenza delle istanze, i
    fatti distinti che non si fondono, il degrado col conto e la posizione
    giuste, e la raffica sotto il tetto che non perde niente;
  - `fubmd-host/tests/il_ponte.rs` — quattro prove sul ponte vero, con la
    barriera: mille `index-updated` che attraversano una volta sola, l'esito di
    un job e un custom che attraversano interi e al proprio posto, il tetto che
    dice «riconcilia» col conto esatto, e il vault fermo in cui ogni fatto arriva
    da solo.
- **Provate al contrario, tutte e cinque le righe che contano:**
  - togliendo il tetto del bus, il subscriber che non ritira accumula tutto e
    `a_subscriber_that_never_takes_stops_growing_and_is_told` fallisce;
  - tenendo la **prima** occorrenza invece dell'ultima, `the_last_one_wins`
    fallisce e mostra la storia raccontata al contrario;
  - mettendo l'`Overflow` in coda invece che al posto di ciò che sostituisce,
    `over_the_ceiling…` fallisce sull'ordine;
  - togliendo il raggruppamento, `una_raffica_attraversa_il_ponte_una_volta_sola`
    fallisce sul ponte **vero** (mille consegne invece di due);
  - togliendo il tetto della raffica, `sopra_il_tetto_il_ponte_dice_riconcilia`
    fallisce. Nessuna delle cinque è decorativa.
- **Contratto invariato da questa metà**: `is_recoverable` è un metodo, non un
  campo; `wit_conformance` e `wit_additivity` restano verdi (l'unica rottura
  dichiarata del commit è quella della [0033](0033-la-grana-di-un-abbonamento.md)).
- `cargo fmt --all` — pulita.
