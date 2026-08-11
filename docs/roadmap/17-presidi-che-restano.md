# 17. I presidi che restano

Una **seduta** della [roadmap infrastrutturale](../todo.md). Contiene attività con priorità flessibile e tempistiche aperte. Il criterio valuta se il costo cresce con l'attesa. **Tutte e tre le voci sono chiuse.**

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Queste tre voci rischiano di rimanere inattive. Applichiamo il criterio della supply chain ([decisione 0001](../decisions/0001-supply-chain-e-sbom.md)). Valutiamo **se il costo cresce con l'attesa**. 
- Il corpus (raccolta di file di test) affronta un costo crescente. Ogni sintassi nuova aggiunge un caso da scrivere a posteriori.
- Gli e2e (test end-to-end completi) e il tracing (sistema di log) mantengono un costo stabile.

Questo criterio ha **tagliato la prima voce**:
- Il corpus e il fuzzing (test con input casuali) presentano un costo crescente.
- Il banco delle prestazioni (test di carico) aspettava una macchina dedicata e non una decisione.

Il round-trip (conversione andata e ritorno) rifatto sul corpus aspettava **il corpus** stesso. Questo vincolo ha chiuso la §17.1 a pezzi invece che a metà. Lo stato dei pezzi risiede nella riga in corsivo sottostante.

**Il criterio aveva torto sull'ultimo pezzo**. Il banco richiedeva una nuova metrica temporale. La [0113](../decisions/0113-il-banco-conta-le-operazioni.md) lo chiude contando le **operazioni** (attraversamenti del confine, parse, allocazioni) da un portatile qualunque. L'analisi ha svelato la rottura della promessa scritta su `Page`. La macchina dedicata serve ancora per una sola attività, creando un buco dichiarato invece di una casella.

### 17.1 Corpus, fuzzing, prestazioni

*ex §4.3 · presidi (test di validazione) · **P2** — **chiusa in quattro pezzi**. Il quarto pezzo ha smentito il taglio dei primi tre: il corpus e il fuzzing si chiudono con la [decisione 0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md), il round-trip sul corpus con la [0061](../decisions/0061-un-giro-che-non-passa-dal-modello.md), il **banco** con la [0113](../decisions/0113-il-banco-conta-le-operazioni.md). Il banco misura operazioni esatte, escludendo i tempi. Il tempo su una macchina condivisa rappresenta un segnale inaffidabile. Questo repo possedeva già la misura dimostrativa.*

- [x] **Fuzzing del parser markdown**: Il requisito 5.3 esige questa verifica. Un parser in panico (crash critico) blocca l'apertura di un vault (cartella di note).
    *   **Implementazione**: Completata con la [0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md). Applica una **rete di regressione deterministica**. Include un generatore xorshift scritto a mano, con seme e conteggio fissi.
    *   **Prestazioni**: Produce ventimila mutazioni del corpus a ogni push in 2,5 secondi. Raggiunge cinque milioni di esecuzioni in ottantaquattro secondi durante la ricerca.
    *   **Alternativa scartata**: Sostituisce `cargo-fuzz`. libFuzzer richiede nightly, un crate separato e una macchina a lunga esecuzione. Questo ostacolo avrebbe generato il secondo presidio inattivo.
    *   **Stato HTML**: L'HTML in ingresso attende sviluppi futuri. Il repo omette un parser HTML. L'HTML appare esclusivamente in uscita. L'importazione futura adotterà le proprietà dell'SDK.

- [x] **Corpus di conformità**: Integra file CommonMark/GFM e snapshot Obsidian-flavored. Completato con la [0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md). Introduce due differenze rispetto alla richiesta originaria.
    *   **La prima (Proprietà vs Snapshot)**: Sfruttiamo sessantadue casi per esaminare sei **proprietà**. Uno snapshot indica una variazione. Una proprietà spiega la natura dell'errore.
    *   **La seconda (Verità sui byte)**: Valutiamo **se il modello descrive fedelmente i byte del file**. Questa proprietà di Fub garantisce le patch chirurgiche. La semplice conformità a CommonMark assoggetterebbe la suite ai bug di comrak.
    *   **Contenimento dei costi**: Il corpus **si confronta** in tre direzioni (varianti del contratto, `custom_kind` del registro, sintassi di `capabilities()`). Un costrutto inedito privo di test fallisce istantaneamente.
    *   **Risultati**: Il sistema ha scovato cinque difetti di produzione e tredici divergenze dichiarate, documentate una per riga.

- [x] **Benchmark su vault grandi** (10k/100k note) in CI. Misura tempi di apertura, ricerca, memoria. Numeri espliciti verificano il "supporto vault enormi". Chiuso con la [0113](../decisions/0113-il-banco-conta-le-operazioni.md). Introduce due differenze misurate oggettivamente:
    *   **La prima (Soglie di tempo)**: Rimuove tre soglie temporali inaffidabili. La riga ne nomina tre e tutte e tre sono tempi. Il presidio della §8.4 confronta due tempi nella stessa corsa. Questo rapporto temporale perfetto ha prodotto 0,97 su ubuntu e 0,89 su windows. Lo spawn dei thread assorbe queste metriche. Il banco misura **operazioni**. Conta gli attraversamenti del confine di apertura (`ceil(N/512)`). La [0051](../decisions/0051-l-alimentazione-risponde.md) aveva scelto questo parametro. Tutte le nove spie del repo omettevano le chiamate. Impostando `FEED_BATCH = 1`, i documenti pareggiano le chiamate a 512. Il banco verifica esattamente zero parse per riaprire un file, e non una frazione. Calcola le allocazioni di una pagina da venti righe, valutando se la spesa **cresce col vault**. Costituisce un rapporto fra due misure sulla stessa macchina.
    *   **La seconda (Campione ridotto)**: Impiega seicento note invece di centomila. Un conto esatto mantiene la sua efficacia a ogni scala. Seicento elementi attraversano il lotto due volte. Centomila comprerebbero unicamente un numero maggiore di secondi.
    *   **Scoperta sull'indice**: Il documento di `Page` garantiva un troncamento preventivo. Tutte le nove famiglie paginate disattendevano questa regola. Venti righe estratte da seicento note richiedevano milleduecentonove allocazioni (due per nota).
    *   **Soluzioni definitive**: Tracciamo tre strade misurate: `Paged::from_source` filtra iteratori, `Paged::window` ordina i dati, altri motori paginano alla sorgente. Abbiamo convertito **una** famiglia (`Entries`). Le altre due candidate falliscono i test. `Drafts` conserva un andamento lineare a monte (la linearità sta in `drafts.read()`, e il `map` sposta il testo invece di copiarlo). `Folders` consuma otto allocazioni per nota dentro `make`. La finestra successiva taglia l'eccesso.

- [x] **Integrazione banco esistente**: Un abitante aspetta il banco (il presidio della §8.4 chiuso con la [0026](../decisions/0026-due-query-insieme.md)).
    *   **Obiettivo originale**: Assicurare che *due ricerche occupino l'indice insieme*. Il file `features/src/search.rs` marca il test come `#[ignore]`.
    *   **Ostacolo temporale**: Ogni colonna impiega una trentina di millisecondi. Lo spawn dei thread copre queste misure. Il runner condiviso segna 0,97. Il test valuta il carico del server circostante. L'esecuzione necessita di un carico dominante e una macchina dedicata ai core (due fattori essenziali per questa voce). Il lancio manuale resta obbligatorio (`cargo test -p fub-features --lib due_ricerche -- --ignored`).
    *   **Scelta tecnica**: Il banco esclude il test. La [0113](../decisions/0113-il-banco-conta-le-operazioni.md) blocca il rinvio continuo. Un sistema a operazioni rifiuta un test basato sul rapporto di due **tempi**.
    *   **Incompatibilità**: Contare processi dentro `query` sovrappone casi fluidi ad attese passive sui `Mutex`. Sarebbero in due lo stesso, uno fermo ad aspettare. Il compilatore verifica l'accesso sicuro (`Send + Sync`), omettendo il reale parallelismo. I lock usano l'accesso condiviso `RwLock::read`, che prende il lock ma non serializza nulla. Il tempo rimane il parametro chiave, fallendo su sistemi condivisi. Identifichiamo il **buco dichiarato n. 6**. Questo buco scompare dai totali.

- [x] **Round-trip import/export**: Il primo giro è nato con la [decisione 0006](../decisions/0006-import-export-come-trait.md) (`transfer_e2e.rs`). Estrae e ripristina un vault manuale.
    *   **Versione aggiornata**: Completo sul corpus con la [0061](../decisions/0061-un-giro-che-non-passa-dal-modello.md). Spiega il valore della riga originaria. I due versi del trasferimento possiedono logiche distinte. Non sono uno solo.
    *   **Esportazione byte**: Bypassa il modello. Le settantacinque sorgenti (sessantadue casi curati e tredici divergenze dichiarate) completano il giro inalterate.
    *   **Rimozione frontmatter**: Attraversa il modello, troncando il file sul primo blocco. Esige che **la struttura non cambi**. Il corpus ha isolato un difetto. Il troncamento cancellava l'indentazione di un code block. Le divergenze documentate rispettano un round-trip autonomo dal modello.

### 17.2 Test della shell

*ex §4.4 · presidi · **P2** — **chiusa** con la [decisione 0112](../decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md). La shell (interfaccia utente) si monta intera contro un host simulato. I comandi simulano i gesti reali. Sostituisce il runner del browser. Valuta esclusivamente il **cablaggio**, ignorato dagli altri presidi.*

**La [§23.16](23-cosa-costano-le-decisioni-chiuse.md#2316-su-windows-un-hardlink-si-stacca-in-silenzio) assorbe metà di questa voce.** Definisce i test per i componenti influenzati dalla piattaforma. La [0109](../decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md) misura questi impatti. Il filtro `#[cfg(unix)]` su Windows salta la compilazione di un test. Le suite svuotate appaiono verdi. Il file [platforms-ci.md](../appendix/platforms-ci.md) documenta l'obbligo di **passare** i rami di OS. Un **numero** contabilizza i test ignorati dal `cfg`. Tutti i presidi seguono questa regola, E2E (test completi end-to-end) compresi. Un E2E attivo su un solo OS ripropone il difetto.

- [x] **E2E dell'app reale** (tauri-driver/Playwright) sui flussi critici (apri vault, scrivi, rinomina, cerca, ripristina). **Fatti** con la [0112](../decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md).
    *   **Architettura e limiti**: Elimina il runner del browser. L'uso di `@playwright/test` integra binari esterni che infrangono la [0001](../decisions/0001-supply-chain-e-sbom.md). L'engine `tauri-driver` esige pacchettizzazioni e webdriver differenziati per piattaforma (un presidio limitato a una macchina sola, il secondo di questa seduta a fermarsi). Delle tre operazioni aggiuntive di un e2e vero, `cargo test` copre già il kernel. Le altre due (serializzazione ponte e rendering webview) costituiscono il **buco dichiarato**.
    *   **Montaggio simulato**: Le due metà richiedono strategie separate. La shell si monta **intera** (`main.ts` e `index.html`) contro `host/finto.ts`. Il vault simulato blocca le variazioni al confine (`typeof import("./ipc")`).
    *   **Gesti di controllo**: I gesti passano da cinque a **sette**. L'azione "rinomina" copre due casistiche (interfaccia ed evento esterno). La seconda casistica celava un bug. Il conteggio aggiornato segna **dodici** gesti [conta: gesti-della-shell]. La [0116](../decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md) include due interazioni per le scorciatoie. L'undicesimo simula il link **dentro** la nota. Il dodicesimo gestisce l'avviso di sessione della 25.5.
    *   **Difetti isolati**: La simulazione ha rimosso Due difetti del cablaggio, sfuggiti alla [0015](../decisions/0015-la-forma-della-shell.md). L'invio della rinomina **riapriva il path vecchio**, duplicando i file. La rinomina esterna alterava il debounce, lasciando le battute nella RAM.

- [x] **Il check di accessibilità passa al §12.4**. Affronta i ruoli ARIA, il focus visibile, il focus trap, la navigazione da tastiera e gli skip link.
    *   **Due ragioni fondamentali**. La prima: un presidio necessita di elementi consolidati, imponendo la scrittura **dopo** le funzioni. La seconda applica il criterio della seduta: il costo **cala** con l'attesa.
    *   **Calo dei costi**: I pannelli formano alberi `UiNode`. La [decisione 0016](../decisions/0016-cosa-e-una-view.md) aggiunge venticinque tipi di nodo e dieci superfici. Un check prematuro avrebbe testato un DOM ormai rimpiazzato.
    *   **Implementazione**: Eseguita assieme alla passata dalla [decisione 0042](../decisions/0042-il-catalogo-della-shell.md). Il test `frontend/src/ui/a11y-check.ts` valuta la scocca conclusiva. La previsione ha confermato l'esattezza dei costi calanti.

### 17.3 Osservabilità

*ex §4.5 · presidi · **P2** — **chiusa** con la [decisione 0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md). Integra `tracing` al posto di `eprintln!`. Usa un collettore locale, log su file con rotazione, configurazioni per livelli e log per-plugin (log associati alle estensioni).*

- [x] **`tracing` in sostituzione di `eprintln!`**: File di log, livelli configurabili e per-plugin integrati. **Fatto** con la [0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md).
    *   **Divisione delle finalità**: Una cosa sola erano **due**. Un guasto gestisce **due** lettori e **due** destinazioni (*il log è il pavimento, l'evento è la porta*).
    *   **Log e `Trouble`**: L'errore scrive una riga `tracing` per gli sviluppatori. Il guasto che genera una **perdita** invia l'`Event::Trouble` della [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md) all'utente finale.
    *   **Conteggi aggiornati**: I ventisette `eprintln!` segnalati dalla 0052 scendono a zero. Sette chiamate aprono la porta. Le altre restano nel pavimento log. La casella della §20.2 raggiunge la chiusura.
    *   **Strumenti locali**: Sostituisce `tracing-subscriber` con un collettore locale (`fub-kernel/src/log.rs`, sessanta righe). La [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) cancella le variabili d'ambiente, e `RUST_LOG` non rientra dalla finestra. Il diagnostic bundle (§15.2) preleva il log generato. Il file ruota raggiunti i dieci mega. Risiede fuori dal vault, vicino alle configurazioni.

- [ ] **Mancanza di contesto in `Event::Trouble`**: L'evento omette la porta d'ingresso.
    *   **Evoluzione dell'identificativo**: La [0105](../decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md) codifica le chiamate dei plugin nel **dato** `Gate` (tredici varianti). L'utente visualizza un testo elaborato da questo dato. L'evento trasporta unicamente la stringa finale.
    *   **Vantaggi proposti**: L'integrazione di un campo porta consentirebbe al centro notifiche di **raggruppare** anomalie simili (es. aggrega tre guasti dispersi causati dallo stesso plugin in un singolo render). Supporta il **conteggio** a livello di registro.
    *   **Ragioni del rinvio**: La modifica impatta un tipo del **contratto** (una firma di sistema). La §23.15 escludeva la priorità per questo intervento. L'aggiornamento avverrà con la revisione delle firme, scorporato dai presidi.
