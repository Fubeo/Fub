//! **Quanto tempo e quanta memoria ha un componente.**
//!
//! Il primo passo di M5 ha portato di là dal confine un plugin che risponde;
//! non ha portato niente che lo fermi se non risponde. Un componente che gira
//! in un ciclo infinito, oggi, tiene il thread del job finché l'app non muore:
//! è il buco che la 0164 ha dichiarato per nome («l'interruzione a epoche e i
//! limiti di memoria»), ed è questo modulo a chiuderlo.
//!
//! I due agganci sono qui e le due chiamate stanno in `componente.rs`, una per
//! parte del ciclo di vita: [`motore`] fabbrica l'`Engine` con la
//! configurazione che rende interrompibile ciò che gira, [`arma`] mette la
//! scadenza e il tetto **sull'istanza** appena nata, che è l'unico posto in cui
//! si sa di chi sono.
//!
//! # Perché le epoche e non il carburante
//!
//! Wasmtime sa fermare il codice ospite in due modi. Il **carburante** conta le
//! istruzioni: è deterministico — la stessa chiamata sugli stessi dati si ferma
//! sempre allo stesso punto — e costa, perché ogni blocco decrementa un
//! contatore locale (fra le due misure di wasmtime ci sono 2-3× di differenza).
//! Le **epoche** contano un numero che qualcun altro incrementa: il codice
//! ospite si limita a confrontarlo con una scadenza, e chi lo incrementa è un
//! battito nostro.
//!
//! Serve il secondo. La domanda a cui questo modulo risponde non è «quante
//! istruzioni può eseguire un plugin» — nessuno la fa, e nessuno saprebbe dire
//! il numero — ma «per quanti **secondi** l'app può restare senza risposta
//! prima che sia un guasto». Quella si misura in tempo, e il tempo è ciò che un
//! battito sa contare. Il determinismo che si perde non lo stava usando
//! nessuno: due plugin diversi hanno comunque due tempi diversi.
//!
//! # Un battito solo, per tutto il processo
//!
//! L'`Engine` sta in una [`OnceLock`] e il battito è il suo thread, uno per
//! processo. L'alternativa — un `Engine` per componente, com'era prima di
//! questo modulo — costerebbe **un thread per plugin caricato**: un costo che
//! non si vede, che cresce con l'utente e non con il lavoro, e che ripaga
//! niente, perché il contatore delle epoche è un `u64` atomico e non c'è
//! nessuna ragione per cui due plugin ne vogliano due.
//!
//! Il prezzo dichiarato è l'altro verso: **il battito non si spegne**. Finché
//! il processo vive e almeno un componente è stato caricato una volta, un
//! thread si sveglia ogni [`BATTITO`] anche se non c'è nessun plugin in
//! esecuzione. È la ragione per cui il periodo è quello che è, e non dieci
//! volte più corto (vedi lì sotto). Scartata l'alternativa di far nascere e
//! morire il battito insieme alla prima e all'ultima chiamata: sarebbe un
//! thread creato e distrutto a ogni giro di job — cioè il costo spostato dal
//! riposo al lavoro, dove dà fastidio davvero — in cambio di dieci risvegli al
//! secondo che una macchina ferma non nota.

use std::sync::OnceLock;
use std::time::Duration;

use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder};

use crate::prestito::Stato;

// ---------------------------------------------------------------------------
// I tre numeri, con la loro ragione
// ---------------------------------------------------------------------------

/// Ogni quanto il battito incrementa l'epoca: **100 ms**.
///
/// È due cose insieme, e vanno lette insieme. È il **costo a riposo** — dieci
/// risvegli al secondo di un thread che fa una somma atomica e torna a dormire,
/// cioè la soglia sotto la quale un portatile comincia a pagare qualcosa per un
/// lavoro che nessuno sta aspettando. Ed è la **grana** della scadenza: la
/// scadenza si misura in battiti, quindi non può essere più fine di così, e ogni
/// numero di [`SCADENZA_IN_BATTITI`] vale ±1 battito di tempo vero.
const BATTITO: Duration = Duration::from_millis(100);

/// Quanti battiti ha una chiamata prima del trap: **50**, cioè circa 5 secondi.
///
/// «Circa» è la parte importante, e va detta invece che nascosta: una scadenza
/// misurata in battiti è **grossolana quanto il battito**. Il primo battito dopo
/// [`arma`] può arrivare un istante dopo oppure quasi un [`BATTITO`] intero
/// dopo, e il conto parte da lì: il tempo vero concesso sta fra
/// `(SCADENZA_IN_BATTITI - 1) * BATTITO` e `SCADENZA_IN_BATTITI * BATTITO`,
/// cioè fra 4,9 s e 5,0 s. Da cui il *numero* di battiti, e non solo il
/// prodotto: con 50 battiti l'incertezza è il 2% del budget; con 5 battiti da
/// un secondo lo stesso budget avrebbe avuto il 20% di incertezza, cioè una
/// scadenza che promette cinque secondi e ne concede quattro. La grana si paga
/// una volta sola, e la si paga scegliendo N grande.
///
/// I 5 secondi, poi. Stanno **sopra** qualunque chiamata legittima di questo
/// contratto — leggere una nota, tradurla, rispondere: millisecondi — e
/// **sotto** il punto in cui una persona smette di aspettare e decide che l'app
/// è bloccata. Il giorno in cui un plugin vero avrà bisogno di più tempo per un
/// job, questo numero si muove qui, in un posto solo, con la sua ragione
/// accanto; ciò che non deve succedere è che non ci sia nessun numero.
const SCADENZA_IN_BATTITI: u64 = 50;

/// Quanto può crescere una memoria lineare di un componente: **64 MiB**.
///
/// Senza tetto il massimo è quello del bersaglio, cioè 4 GiB: un plugin che
/// alloca in un ciclo non muore lui, fa morire l'app, e la fa morire con un
/// messaggio che parla del processo e non del plugin. Il tetto è ciò che
/// rovescia la frase — chi sbaglia paga, e paga da solo.
///
/// 64 MiB perché è quasi due ordini di grandezza sopra il lavoro vero di un
/// plugin di questo contratto: ciò che attraversa il confine sono note, cioè
/// testo, e anche una nota patologica sta in pochi MiB insieme all'albero in cui
/// la si parsa. Ed è un **massimo, non una prenotazione**: la memoria lineare
/// cresce a pagine su richiesta, quindi dieci plugin montati costano ciò che
/// usano e non 640 MiB. Il conto che conta è l'altro — quanto può prendersi
/// *uno* prima che qualcuno se ne accorga — e 64 MiB è una cifra che un utente
/// vede nel monitor delle attività senza che l'app sia già in ginocchio.
const TETTO_DI_MEMORIA: usize = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Il motore, e il suo battito
// ---------------------------------------------------------------------------

/// L'`Engine` del processo. Nasce alla prima [`motore`] e non muore più.
static MOTORE: OnceLock<Engine> = OnceLock::new();

/// L'`Engine` con cui si compila ogni componente.
///
/// È **uno solo** per processo, e prima di questo modulo ce n'era uno per
/// caricamento. Il cambio non è un'ottimizzazione di passaggio: il contatore
/// delle epoche appartiene all'`Engine`, quindi un `Engine` per componente
/// vorrebbe dire un battito per componente. Con uno solo il battito è uno solo,
/// e in più i componenti si spartiscono lo stato del compilatore invece di
/// rifabbricarlo a ogni `.wasm`.
pub(crate) fn motore() -> Engine {
    MOTORE
        .get_or_init(|| {
            let mut config = Config::new();
            // Senza questa riga il resto del modulo non esiste: è lei che dice
            // a cranelift di infilare il controllo dell'epoca all'ingresso di
            // ogni funzione e a ogni giro di ciclo. Il controllo è ciò che
            // raggiunge un componente che non chiama nessuno — l'host non ha
            // nessun altro modo di farsi sentire dentro un `loop {}`.
            config.epoch_interruption(true);

            // L'`expect` è una scelta, non una scorciatoia. Questa `Config` non
            // ha un solo parametro che venga da fuori: se la combinazione è
            // invalida lo è a ogni avvio del processo e per ogni plugin, non per
            // *questo* plugin. Restituirla come errore di caricamento
            // significherebbe scrivere «il componente non si compila» accanto a
            // un componente che non ha nessuna colpa, e mandare a cercare dalla
            // parte sbagliata.
            let engine = Engine::new(&config)
                .expect("la configurazione del motore WASM è scritta qui, non arriva da fuori");
            batti(engine.clone());
            engine
        })
        .clone()
}

/// Il battito: un thread che dorme e incrementa l'epoca.
///
/// Tiene un `Engine` **forte** e non un `EngineWeak`, che sarebbe la forma che
/// wasmtime suggerisce. La forma debole serve a chi vuole che il thread muoia
/// con l'ultimo consumatore dell'`Engine`; qui l'`Engine` sta in [`MOTORE`],
/// cioè in una statica che vive quanto il processo, e un handle debole
/// racconterebbe una morte che non arriva mai — una riga di codice che non gira
/// e una condizione che sembra gestita.
fn batti(engine: Engine) {
    std::thread::Builder::new()
        // Corto di proposito: Linux tronca il nome di un thread a 15 caratteri,
        // e un nome tagliato a metà è un nome che in `top` non si riconosce.
        .name("battito-wasm".to_string())
        .spawn(move || loop {
            std::thread::sleep(BATTITO);
            // Una somma atomica rilassata, e niente altro: è ciò che rende il
            // battito economico abbastanza da non doverlo spegnere.
            engine.increment_epoch();
        })
        .expect("il thread del battito nasce all'avvio, prima di qualunque plugin");
}

// ---------------------------------------------------------------------------
// La scadenza e il tetto sull'istanza
// ---------------------------------------------------------------------------

/// Il tetto di memoria di un'istanza, da tenere dentro lo [`Stato`].
///
/// Vive nello `Stato` e non qui perché `Store::limiter` vuole una chiusura che
/// peschi il limitatore **dal dato dello store**: è il modo in cui wasmtime
/// permette a un limitatore di avere memoria di ciò che ha già concesso.
///
/// Le altre manopole di [`StoreLimitsBuilder`] — `instances`, `tables`,
/// `memories`, `table_elements` — restano ai valori di wasmtime, e non per
/// distrazione. Quante istanze e quante memorie **core** diventi un componente è
/// un fatto della catena che lo ha compilato, non del plugin: un numero scelto
/// qui sarebbe una previsione sul compilatore di qualcun altro, e un plugin
/// onesto rifiutato per averne una di troppo verrebbe rifiutato per la ragione
/// sbagliata. `memory_size` è il solo tetto il cui significato non cambia da una
/// catena all'altra — quanta memoria può prendersi il plugin — ed è quello che
/// stiamo mettendo.
///
/// Nota che `memory_size` vale **per memoria**: un componente con due memorie
/// lineari può arrivare a due volte il tetto. È vero, è dichiarato, e non
/// cambia l'ordine di grandezza — ciò che il tetto impedisce è il ciclo che
/// alloca finché c'è RAM, e quello lo impedisce comunque.
///
/// `trap_on_grow_failure` resta spento. Con lui acceso un `memory.grow` che non
/// riesce diventa subito un trap col messaggio di wasmtime; spento, restituisce
/// `-1` come dice la specifica, e il plugin ha la sua occasione di rispondere
/// «non c'è posto» con un `plugin-error`, che è un valore del contratto — la
/// stessa scelta di `trappable_imports` spento (0164). Chi quell'occasione non
/// la sa usare — ed è il caso dell'allocatore di default di Rust, che chiama
/// `handle_alloc_error` e aborta — trappa da sé una riga dopo, con lo stesso
/// esito. Accendere l'opzione toglierebbe qualcosa al primo senza dare niente al
/// secondo.
pub(crate) fn tetto() -> StoreLimits {
    StoreLimitsBuilder::new()
        .memory_size(TETTO_DI_MEMORIA)
        .build()
}

/// Mette scadenza e tetto a un'istanza appena creata.
///
/// «Appena creata» è letterale: la chiama `Componente::istanzia` **prima** di
/// `instantiate`, perché la prima cosa che il componente esegue è la propria
/// funzione di avvio, ed è già codice ospite. Un componente che si impicca nel
/// proprio `start` non deve poter tenere il thread che lo sta montando.
pub(crate) fn arma(store: &mut Store<Stato>) {
    store.limiter(|stato| stato.limiti());
    // È già il comportamento di default di wasmtime, e lo scriviamo lo stesso:
    // che una scadenza scaduta abbatta il componente invece di sospenderlo o di
    // chiamare qualcuno è la decisione di questo modulo, e una decisione che
    // vive solo nel default di una libreria è una decisione che cambia il
    // giorno in cui cambia la libreria.
    store.epoch_deadline_trap();
    rinnova(store);
}

/// Rimette il cronometro a [`SCADENZA_IN_BATTITI`].
///
/// La scadenza di wasmtime è **assoluta**: `set_epoch_deadline(n)` vuol dire
/// «all'epoca corrente più n», e da quel momento il conto scorre anche mentre
/// nessuno esegue niente. Armarla una volta sola all'istanziazione darebbe la
/// cosa sbagliata — un plugin montato all'avvio sarebbe morto cinque secondi
/// dopo, senza aver mai fatto nulla, e il primo job del pomeriggio troverebbe un
/// componente già scaduto.
///
/// Il budget che vogliamo è **per chiamata**, e la parentesi di una chiamata in
/// questo crate ha già un nome: `crate::prestito::con_ospite`, che presta l'host
/// per la durata di un `activate`, di un `deactivate`, di un `run_job` e di
/// niente altro. È lì che il cronometro riparte, ed è per questo che questa
/// funzione è `pub(crate)` invece di stare dentro [`arma`].
pub(crate) fn rinnova(store: &mut Store<Stato>) {
    store.set_epoch_deadline(SCADENZA_IN_BATTITI);
}
