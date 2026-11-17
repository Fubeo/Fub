//! **Quanto tempo e quanta memoria ha un componente.**
//!
//! Il primo passo di M5 ha portato di là dal confine un plugin che risponde;
//! non ha portato niente che lo fermi se non risponde. Un componente che gira
//! in un ciclo infinito, oggi, tiene il thread del job finché l'app non muore:
//! è il buco che la 0164 ha dichiarato per nome («l'interruzione a epoche e i
//! limiti di memoria»), ed è questo modulo a chiuderlo.
//!
//! I due agganci sono qui e le due chiamate stanno in `componente.rs`, una per
//! parte del ciclo di vita: [`engine`] fabbrica l'`Engine` con la
//! configurazione che rende interrompibile ciò che gira, [`arm`] mette la
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
//! thread si sveglia ogni [`HEARTBEAT`] anche se non c'è nessun plugin in
//! esecuzione. È la ragione per cui il periodo è quello che è, e non dieci
//! volte più corto (vedi lì sotto). Scartata l'alternativa di far nascere e
//! morire il battito insieme alla prima e all'ultima chiamata: sarebbe un
//! thread creato e distrutto a ogni giro di job — cioè il costo spostato dal
//! riposo al lavoro, dove dà fastidio davvero — in cambio di dieci risvegli al
//! secondo che una macchina ferma non nota.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use wasmtime::{Config, Engine, ResourceLimiter, Store};

use crate::borrow::State;

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
/// numero di [`TIMEOUT_IN_TICKS`] vale ±1 battito di tempo vero.
const HEARTBEAT: Duration = Duration::from_millis(100);

/// Quanti battiti ha una chiamata prima del trap: **50**, cioè circa 5 secondi.
///
/// «Circa» è la parte importante, e va detta invece che nascosta: una scadenza
/// misurata in battiti è **grossolana quanto il battito**. Il primo battito dopo
/// [`arm`] può arrivare un istante dopo oppure quasi un [`HEARTBEAT`] intero
/// dopo, e il conto parte da lì: il tempo vero concesso sta fra
/// `(TIMEOUT_IN_TICKS - 1) * HEARTBEAT` e `TIMEOUT_IN_TICKS * HEARTBEAT`,
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
const TIMEOUT_IN_TICKS: u64 = 50;

/// Quanto possono crescere le memorie lineari di un'istanza, **tutte insieme**:
/// **64 MiB**.
///
/// Il tetto conta la somma delle memorie dell'istanza, non ciascuna: un
/// componente con due memorie lineari non arriva a due volte il tetto.
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
const MEMORY_CEILING: usize = 64 * 1024 * 1024;

/// Quanta memoria lineare possono tenere **tutte le istanze del processo**
/// insieme: **1 GiB**.
///
/// Il tetto per istanza ferma il plugin che alloca in un ciclo; non ferma
/// molte istanze che arrivano ciascuna al proprio tetto. Il fermo delle
/// istanze vive ([`crate::budgets::MAX_LIVE_INSTANCES`]) non è una quota di
/// memoria: 64 istanze al tetto sono 4 GiB. Questo numero sì: sedici istanze
/// al tetto, due ordini di grandezza sopra ciò che i plugin di questo
/// contratto usano davvero (pochi MiB ciascuno), e sotto il punto in cui un
/// portatile con 8 GiB comincia a soffrire.
///
/// Oltre, la crescita non risponde `-1` come al tetto dell'istanza: la colpa
/// non è dell'istanza che chiede, ma il posto è finito. Diventa una trap con
/// [`MemoryBudgetExceeded`], che l'host traduce nell'errore tipizzato
/// `host.wasm.memory_budget`, e un'istanza che non nasce per questo è un
/// [`crate::LoadError::MemoryBudget`].
pub(crate) const PROCESS_MEMORY_CEILING: usize = 1024 * 1024 * 1024;

/// Il tetto degli elementi di **una** tabella: lo stesso ordine di memoria
/// della memoria lineare.
///
/// Una tabella non vive nella memoria del plugin ma in quella dell'host, e
/// `table.grow` la alloca e la riempie tutta prima di rispondere: senza tetto,
/// la RAM che [`MEMORY_CEILING`] nega a `memory.grow` un plugin la prende a
/// tabelle, un salto alla volta, finché c'è. Un elemento costa all'host circa
/// un puntatore, da qui l'ottavo. La tabella di un componente vero ha qualche
/// migliaio di voci, tre ordini di grandezza sotto.
const TABLE_CEILING: usize = MEMORY_CEILING / 8;

/// Quanti byte di `wasi:random` può chiedere **una chiamata** del contratto,
/// sommando tutte le sue richieste: **1 MiB**.
///
/// Il tetto di una richiesta (64 KiB, in `component.rs`) ferma la lunghezza da
/// gigabyte, non il ciclo che chiede 64 KiB alla volta finché la scadenza non
/// scatta: cinque secondi di generatore del sistema sono centinaia di MiB
/// allocati e copiati dall'host. Un guest vero chiede semi e chiavi da decine
/// di byte, e il seme delle `HashMap` della std ne chiede sedici: un MiB sta
/// quattro ordini di grandezza sopra. Il budget ha la stessa parentesi della
/// scadenza — riparte in [`renew`] a ogni chiamata — quindi insieme danno anche
/// il ritmo: al più un MiB per chiamata, e le chiamate le fa l'host. Oltre, la
/// richiesta è una trap, come la lunghezza fuori tetto.
pub(crate) const RANDOM_BUDGET: u64 = 1024 * 1024;

// ---------------------------------------------------------------------------
// Il motore, e il suo battito
// ---------------------------------------------------------------------------

/// L'`Engine` del processo. Nasce alla prima [`engine`] e non muore più.
static ENGINE: OnceLock<Engine> = OnceLock::new();

/// Come l'engine compila: nativo Cranelift, o Pulley interprete portatile.
///
/// Pulley è l'interprete portabile di wasmtime: stesso formato `.wasm`, nessuna
/// JIT nativa, quindi gira dove la JIT è vietata (iOS) e su architetture senza
/// backend Cranelift. Il prezzo è la velocità (interprete contro codice
/// nativo) e va pagato solo dove serve: la scelta vive in una variabile
/// d'ambiente letta una volta sola, come il resto di questa configurazione.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum EngineBackend {
    /// Cranelift nativo: il default su desktop, la via veloce.
    #[default]
    Native,
    /// Pulley interprete: portabile dove la JIT non arriva.
    Pulley,
}

impl EngineBackend {
    /// Il backend configurato: variabile `FUB_WASM_BACKEND` più default di
    /// piattaforma. Non tocca l'engine e non lo crea: è ciò che la UI deve
    /// dichiarare come `configured` finché l'engine non esiste.
    ///
    /// Su iOS il configurato è sempre Pulley: la JIT nativa è vietata e nessun
    /// override silenzioso può abilitare Cranelift. Altrove `pulley` sceglie
    /// l'interprete, ogni altro valore (o l'assenza) sceglie il nativo.
    fn configured() -> Self {
        #[cfg(target_os = "ios")]
        {
            EngineBackend::Pulley
        }
        #[cfg(not(target_os = "ios"))]
        {
            match std::env::var("FUB_WASM_BACKEND")
                .map(|v| v.to_ascii_lowercase())
                .as_deref()
            {
                Ok("pulley") => EngineBackend::Pulley,
                _ => EngineBackend::Native,
            }
        }
    }

    /// Nome del backend configurato, senza creare l'engine. È ciò che la UI
    /// mostra come `configured:` quando l'engine non è ancora nato.
    pub(crate) fn configured_name() -> &'static str {
        match Self::configured() {
            EngineBackend::Native => "native",
            EngineBackend::Pulley => "pulley",
        }
    }

    /// Il backend effettivamente usato dall'engine di processo, se l'engine
    /// esiste già. Non crea l'engine: un getter che lo creasse spaccerebbe
    /// l'env letto per engine attivo. `None` = engine non ancora nato, la UI
    /// dichiara solo il configurato.
    pub(crate) fn active() -> Option<Self> {
        ACTIVE_BACKEND.get().copied()
    }

    /// Nome del backend attivo, se l'engine esiste già. `None` = non ancora
    /// nato: mostrare il configurato, non inventare un attivo.
    pub(crate) fn active_name() -> Option<&'static str> {
        Self::active().map(|backend| match backend {
            EngineBackend::Native => "native",
            EngineBackend::Pulley => "pulley",
        })
    }
}

static ACTIVE_BACKEND: OnceLock<EngineBackend> = OnceLock::new();

/// L'`Engine` con cui si compila ogni componente.
///
/// È **uno solo** per processo, e prima di questo modulo ce n'era uno per
/// caricamento. Il cambio non è un'ottimizzazione di passaggio: il contatore
/// delle epoche appartiene all'`Engine`, quindi un `Engine` per componente
/// vorrebbe dire un battito per componente. Con uno solo il battito è uno solo,
/// e in più i componenti si spartiscono lo stato del compilatore invece di
/// rifabbricarlo a ogni `.wasm`.
pub(crate) fn engine() -> Engine {
    ENGINE
        .get_or_init(|| {
            let mut config = Config::new();
            // Senza questa riga il resto del modulo non esiste: è lei che dice
            // a cranelift di infilare il controllo dell'epoca all'ingresso di
            // ogni funzione e a ogni giro di ciclo. Il controllo è ciò che
            // raggiunge un componente che non chiama nessuno — l'host non ha
            // nessun altro modo di farsi sentire dentro un `loop {}`.
            config.epoch_interruption(true);

            // Pulley dove la JIT nativa è vietata o assente (iOS: sempre, senza
            // override). Si sceglie con `FUB_WASM_BACKEND=pulley` e si prova su
            // Linux con lo stesso `.wasm`, prima di parlarne su iOS. Il target
            // `pulley64` è interprete puro: `Engine::new` fallisce qui — una
            // volta sola, con un messaggio che nomina il backend — invece di
            // far fallire ogni caricamento con un componente innocente accanto.
            let backend = EngineBackend::configured();
            if backend == EngineBackend::Pulley {
                if let Err(error) = config.target("pulley64") {
                    panic!("backend Pulley non disponibile in questa build: {error}");
                }
            }

            // L'`expect` è una scelta, non una scorciatoia. Questa `Config` non
            // ha un solo parametro che venga da fuori: se la combinazione è
            // invalida lo è a ogni avvio del processo e per ogni plugin, non per
            // *questo* plugin. Restituirla come errore di caricamento
            // significherebbe scrivere «il componente non si compila» accanto a
            // un componente che non ha nessuna colpa, e mandare a cercare dalla
            // parte sbagliata.
            let engine = Engine::new(&config)
                .expect("WASM engine configuration is set here, not passed in from outside");
            let _ = ACTIVE_BACKEND.set(backend);
            tick(engine.clone());
            engine
        })
        .clone()
}

/// Il battito: un thread che dorme e incrementa l'epoca.
///
/// Tiene un `Engine` **forte** e non un `EngineWeak`, che sarebbe la forma che
/// wasmtime suggerisce. La forma debole serve a chi vuole che il thread muoia
/// con l'ultimo consumatore dell'`Engine`; qui l'`Engine` sta in [`ENGINE`],
/// cioè in una statica che vive quanto il processo, e un handle debole
/// racconterebbe una morte che non arriva mai — una riga di codice che non gira
/// e una condizione che sembra gestita.
fn tick(engine: Engine) {
    std::thread::Builder::new()
        // Corto di proposito: Linux tronca il nome di un thread a 15 caratteri,
        // e un nome tagliato a metà è un nome che in `top` non si riconosce.
        .name("heartbeat-wasm".to_string())
        .spawn(move || loop {
            std::thread::sleep(HEARTBEAT);
            // Una somma atomica rilassata, e niente altro: è ciò che rende il
            // battito economico abbastanza da non doverlo spegnere.
            engine.increment_epoch();
        })
        .expect("the heartbeat thread is born at startup, before any plugin");
}

// ---------------------------------------------------------------------------
// La scadenza e il tetto sull'istanza
// ---------------------------------------------------------------------------

/// La memoria lineare che le istanze del processo possono ancora prendersi
/// ([`PROCESS_MEMORY_CEILING`]): un contatore atomico che ogni [`Limiter`]
/// carica quando una sua memoria nasce o cresce, e scarica quando lo store
/// muore. La memoria lineare non si accorcia, quindi «quando lo store muore» è
/// l'unico momento in cui torna.
#[derive(Debug)]
pub(crate) struct MemoryPool {
    used: AtomicUsize,
    ceiling: usize,
}

impl MemoryPool {
    pub(crate) const fn new(ceiling: usize) -> Self {
        Self {
            used: AtomicUsize::new(0),
            ceiling,
        }
    }

    /// Prende `bytes` dal pool, o rifiuta senza toccarlo.
    fn take(&self, bytes: usize) -> Result<(), MemoryBudgetExceeded> {
        let mut used = self.used.load(Ordering::Acquire);
        loop {
            let next = used.saturating_add(bytes);
            if next > self.ceiling {
                return Err(MemoryBudgetExceeded {
                    asked: bytes,
                    used,
                    ceiling: self.ceiling,
                });
            }
            match self
                .used
                .compare_exchange_weak(used, next, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => return Ok(()),
                Err(now) => used = now,
            }
        }
    }

    fn give_back(&self, bytes: usize) {
        self.used.fetch_sub(bytes, Ordering::AcqRel);
    }

    /// I byte presi adesso, da tutte le istanze.
    pub(crate) fn used(&self) -> usize {
        self.used.load(Ordering::Acquire)
    }
}

/// Il pool del processo.
pub(crate) static PROCESS_POOL: MemoryPool = MemoryPool::new(PROCESS_MEMORY_CEILING);

/// La memoria lineare di tutte le istanze del processo è finita: la crescita
/// che la chiedeva è una trap, e l'host la traduce in un errore tipizzato.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error(
    "la memoria dei componenti WASM è finita: {asked} byte chiesti, {used} già presi su {ceiling}"
)]
pub struct MemoryBudgetExceeded {
    /// I byte che la crescita chiedeva.
    pub asked: usize,
    /// I byte che tutte le istanze tenevano già.
    pub used: usize,
    /// Il tetto del processo ([`PROCESS_MEMORY_CEILING`]).
    pub ceiling: usize,
}

/// Il limitatore di un'istanza, da tenere dentro lo [`State`].
///
/// Vive nello `State` e non qui perché `Store::limiter` vuole una chiusura che
/// peschi il limitatore **dal dato dello store**: è il modo in cui wasmtime
/// permette a un limitatore di avere memoria di ciò che ha già concesso.
///
/// Conta due tetti. [`MEMORY_CEILING`] vale per la somma delle memorie
/// lineari dell'istanza, non per ciascuna: con due memorie non si arriva al
/// doppio. [`PROCESS_MEMORY_CEILING`] vale per tutte le istanze del processo
/// insieme, attraverso il [`MemoryPool`]: ciò che un'istanza ha preso torna al
/// pool quando il suo store muore ([`Drop`]).
///
/// I conteggi di istanze, tabelle e memorie **core** restano ai valori di
/// wasmtime, e non per distrazione. Quante istanze e quante memorie core
/// diventi un componente è un fatto della catena che lo ha compilato, non del
/// plugin: un numero scelto qui sarebbe una previsione sul compilatore di
/// qualcun altro, e un plugin onesto rifiutato per averne una di troppo
/// verrebbe rifiutato per la ragione sbagliata. I byte delle memorie e gli
/// elementi delle tabelle ([`TABLE_CEILING`]) sono i tetti il cui significato
/// non cambia da una catena all'altra.
///
/// Al tetto dell'istanza `memory.grow` resta spento come trap. Con lui acceso un `memory.grow` che non
/// riesce diventa subito un trap col messaggio di wasmtime; spento, restituisce
/// `-1` come dice la specifica, e il plugin ha la sua occasione di rispondere
/// «non c'è posto» con un `plugin-error`, che è un valore del contratto — la
/// stessa scelta di `trappable_imports` spento (0164). Chi quell'occasione non
/// la sa usare — ed è il caso dell'allocatore di default di Rust, che chiama
/// `handle_alloc_error` e aborta — trappa da sé una riga dopo, con lo stesso
/// esito. Accendere l'opzione toglierebbe qualcosa al primo senza dare niente al
/// secondo. Il tetto del processo invece è una trap ([`MemoryBudgetExceeded`]):
/// lì la colpa non è dell'istanza, e l'errore deve dire che cosa è finito.
#[derive(Debug)]
pub(crate) struct Limiter {
    pool: &'static MemoryPool,
    /// I byte di tutte le memorie lineari di questo store, presi dal pool.
    held: usize,
    /// L'ultima crescita concessa: se wasmtime poi non riesce a farla
    /// (`memory_grow_failed`), torna al pool.
    pending: usize,
}

impl Limiter {
    pub(crate) fn new(pool: &'static MemoryPool) -> Self {
        Self {
            pool,
            held: 0,
            pending: 0,
        }
    }
}

impl Drop for Limiter {
    fn drop(&mut self) {
        self.pool.give_back(self.held);
    }
}

impl ResourceLimiter for Limiter {
    fn memory_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        self.pending = 0;
        if maximum.is_some_and(|max| desired > max) {
            return Ok(false);
        }
        let grow = desired.saturating_sub(current);
        let total = self.held.saturating_add(grow);
        if total > MEMORY_CEILING {
            return Ok(false);
        }
        self.pool.take(grow)?;
        self.held = total;
        self.pending = grow;
        Ok(true)
    }

    fn memory_grow_failed(&mut self, _error: wasmtime::Error) -> wasmtime::Result<()> {
        self.held -= self.pending;
        self.pool.give_back(self.pending);
        self.pending = 0;
        Ok(())
    }

    fn table_growing(
        &mut self,
        _current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        Ok(desired <= TABLE_CEILING && maximum.is_none_or(|max| desired <= max))
    }
}

/// Il limitatore di una nuova istanza, sul pool del processo.
pub(crate) fn ceiling() -> Limiter {
    Limiter::new(&PROCESS_POOL)
}

/// Mette scadenza e tetto a un'istanza appena creata.
///
/// «Appena creata» è letterale: la chiama `Component::istanzia` **prima** di
/// `instantiate`, perché la prima cosa che il componente esegue è la propria
/// funzione di avvio, ed è già codice ospite. Un componente che si impicca nel
/// proprio `start` non deve poter tenere il thread che lo sta montando.
pub(crate) fn arm(store: &mut Store<State>) {
    store.limiter(|state| state.limits());
    // È già il comportamento di default di wasmtime, e lo scriviamo lo stesso:
    // che una scadenza scaduta abbatta il componente invece di sospenderlo o di
    // chiamare qualcuno è la decisione di questo modulo, e una decisione che
    // vive solo nel default di una libreria è una decisione che cambia il
    // giorno in cui cambia la libreria.
    store.epoch_deadline_trap();
    renew(store);
}

/// Rimette il cronometro a [`TIMEOUT_IN_TICKS`].
///
/// La scadenza di wasmtime è **assoluta**: `set_epoch_deadline(n)` vuol dire
/// «all'epoca corrente più n», e da quel momento il conto scorre anche mentre
/// nessuno esegue niente. Armarla una volta sola all'istanziazione darebbe la
/// cosa sbagliata — un plugin montato all'avvio sarebbe morto cinque secondi
/// dopo, senza aver mai fatto nulla, e il primo job del pomeriggio troverebbe un
/// componente già scaduto.
///
/// Il budget che vogliamo è **per chiamata**, e la parentesi di una chiamata in
/// questo crate ha già un nome: `crate::borrow::with_guest`, che presta l'host
/// per la durata di un `activate`, di un `deactivate`, di un `run_job` e di
/// niente altro. È lì che il cronometro riparte, ed è per questo che questa
/// funzione è `pub(crate)` invece di stare dentro [`arm`].
pub(crate) fn renew(store: &mut Store<State>) {
    store.set_epoch_deadline(TIMEOUT_IN_TICKS);
    store.data_mut().refill_random();
}

#[cfg(test)]
mod tests {
    use super::{
        arm, engine, Limiter, MemoryBudgetExceeded, MemoryPool, MEMORY_CEILING,
        PROCESS_MEMORY_CEILING, TABLE_CEILING,
    };
    use crate::borrow::State;
    use wasmtime::{Instance, Module, ResourceLimiter, Store};

    /// Un modulo con una tabella di funzioni da un elemento e una funzione che
    /// la fa crescere: `(func (export "grow") (param i32) (result i32)
    /// (table.grow 0 (ref.null func) (local.get 0)))`. Scritto in binario
    /// perché il crate non accende `wat`.
    const GROWS_A_TABLE: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // intestazione
        0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f, // tipo (i32) -> i32
        0x03, 0x02, 0x01, 0x00, // una funzione di quel tipo
        0x04, 0x04, 0x01, 0x70, 0x00, 0x01, // tabella funcref, minimo 1, senza massimo
        0x07, 0x08, 0x01, 0x04, b'g', b'r', b'o', b'w', 0x00, 0x00, // export "grow"
        0x0a, 0x0b, 0x01, 0x09, 0x00, 0xd0, 0x70, 0x20, 0x00, 0xfc, 0x0f, 0x00, 0x0b,
    ];

    /// **Una tabella trova il suo tetto come la memoria.** Senza, `table.grow`
    /// fa allocare e riempire all'host quanti elementi chiede il plugin: la
    /// memoria che il tetto della memoria lineare nega, il plugin la prende di
    /// qui, e l'esito è la RAM dell'app intera invece di un `-1` al plugin.
    #[test]
    fn a_table_finds_the_ceiling_like_memory() {
        let engine = engine();
        let module = Module::new(&engine, GROWS_A_TABLE).expect("the module compiles");
        let mut store = Store::new(&engine, State::empty());
        arm(&mut store);
        let instance = Instance::new(&mut store, &module, &[]).expect("the module instantiates");
        let grow = instance
            .get_typed_func::<i32, i32>(&mut store, "grow")
            .expect("grow is exported");

        // Un plugin onesto cresce: la tabella di un componente vero ha qualche
        // migliaio di voci.
        assert_eq!(grow.call(&mut store, 10_000).unwrap(), 1);
        let beyond = i32::try_from(TABLE_CEILING).unwrap();
        assert_eq!(
            grow.call(&mut store, beyond).unwrap(),
            -1,
            "oltre il tetto `table.grow` risponde -1, come `memory.grow`"
        );
        assert_eq!(
            grow.call(&mut store, 1).unwrap(),
            10_001,
            "il rifiuto non ha cambiato la tabella"
        );
    }

    /// Un modulo con **due** memorie lineari, senza massimo, e una funzione
    /// che fa crescere ciascuna: `grow0` e `grow1`, `(param i32) (result
    /// i32)`, `memory.grow 0` e `memory.grow 1`.
    const TWO_MEMORIES: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // intestazione
        0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f, // tipo (i32) -> i32
        0x03, 0x03, 0x02, 0x00, 0x00, // due funzioni di quel tipo
        0x05, 0x05, 0x02, 0x00, 0x00, 0x00, 0x00, // due memorie, minimo 0
        0x07, 0x11, 0x02, // due export
        0x05, b'g', b'r', b'o', b'w', b'0', 0x00, 0x00, // "grow0" → funzione 0
        0x05, b'g', b'r', b'o', b'w', b'1', 0x00, 0x01, // "grow1" → funzione 1
        0x0a, 0x0f, 0x02, // due corpi
        0x06, 0x00, 0x20, 0x00, 0x40, 0x00, 0x0b, // memory.grow 0 (local.get 0)
        0x06, 0x00, 0x20, 0x00, 0x40, 0x01, 0x0b, // memory.grow 1 (local.get 0)
    ];

    /// Pagine di 64 KiB in un tetto di byte.
    fn pages(bytes: usize) -> i32 {
        i32::try_from(bytes / 65_536).unwrap()
    }

    struct Grower {
        store: Store<Limiter>,
        grow: [wasmtime::TypedFunc<i32, i32>; 2],
    }

    impl Grower {
        fn new(pool: &'static MemoryPool) -> Self {
            let engine = engine();
            let module = Module::new(&engine, TWO_MEMORIES).expect("the module compiles");
            let mut store = Store::new(&engine, Limiter::new(pool));
            store.limiter(|limiter| limiter as &mut dyn ResourceLimiter);
            store.set_epoch_deadline(super::TIMEOUT_IN_TICKS);
            let instance =
                Instance::new(&mut store, &module, &[]).expect("the module instantiates");
            let grow = ["grow0", "grow1"].map(|name| {
                instance
                    .get_typed_func::<i32, i32>(&mut store, name)
                    .expect("exported")
            });
            Grower { store, grow }
        }

        fn grow(&mut self, memory: usize, pages: i32) -> wasmtime::Result<i32> {
            self.grow[memory].call(&mut self.store, pages)
        }
    }

    /// **Le memorie di un'istanza stanno sotto un tetto solo.** Prima il tetto
    /// valeva per memoria, e un componente con due memorie arrivava al doppio.
    #[test]
    fn two_memories_share_the_instance_ceiling() {
        static POOL: MemoryPool = MemoryPool::new(PROCESS_MEMORY_CEILING);
        let mut grower = Grower::new(&POOL);
        let half = pages(MEMORY_CEILING) / 2 + 100;
        assert_eq!(
            grower.grow(0, half).unwrap(),
            0,
            "una memoria sotto il tetto cresce"
        );
        assert_eq!(
            grower.grow(1, half).unwrap(),
            -1,
            "la seconda memoria passerebbe il tetto dell'istanza: -1, come per una"
        );
        let rest = pages(MEMORY_CEILING) - half;
        assert_eq!(grower.grow(1, rest).unwrap(), 0, "fino al tetto, sì");
        assert_eq!(grower.grow(0, 1).unwrap(), -1, "e poi più niente");
        assert_eq!(POOL.used(), MEMORY_CEILING);
        drop(grower);
        assert_eq!(
            POOL.used(),
            0,
            "lo store che muore restituisce la sua memoria"
        );
    }

    /// **Tutte le istanze del processo stanno sotto un tetto comune.** Oltre,
    /// la crescita è una trap con l'errore tipizzato, e la memoria di uno store
    /// che muore torna disponibile.
    #[test]
    fn the_process_pool_refuses_with_a_typed_error_and_takes_memory_back() {
        const POOL_BYTES: usize = 100 * 65_536;
        static POOL: MemoryPool = MemoryPool::new(POOL_BYTES);
        let mut first = Grower::new(&POOL);
        let mut second = Grower::new(&POOL);
        assert_eq!(first.grow(0, 60).unwrap(), 0);
        let error = second.grow(0, 60).expect_err("oltre il pool del processo");
        let budget = error
            .downcast_ref::<MemoryBudgetExceeded>()
            .expect("la trap porta l'errore tipizzato");
        assert_eq!(
            *budget,
            MemoryBudgetExceeded {
                asked: 60 * 65_536,
                used: 60 * 65_536,
                ceiling: POOL_BYTES
            }
        );
        assert!(matches!(
            crate::component::failure(error),
            fub_abi::PluginError::Internal(text)
                if text.as_message().is_some_and(|m| m.key == "host.wasm.memory_budget")
        ));
        assert_eq!(POOL.used(), 60 * 65_536, "il rifiuto non ha preso niente");
        drop(first);
        drop(second);
        assert_eq!(POOL.used(), 0);
        let mut third = Grower::new(&POOL);
        assert_eq!(
            third.grow(1, 60).unwrap(),
            0,
            "la memoria restituita torna disponibile"
        );
    }
}
