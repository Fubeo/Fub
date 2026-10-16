//! **La porta unica dei lucchetti dell'host**, e la politica che ci sta dentro
//! (decisione 0120).
//!
//! # Il difetto non era il panico
//!
//! Il panico lo aveva già affrontato la [0032]: un provider che pania costa la
//! *chiamata*, non il vault, e la rete sta in [`fub_kernel::safety`]. Il doc di
//! quel modulo però descriveva il resto del guaio senza ripararlo — *«i
//! `.write().unwrap()` di chi monta lo traducono in un panico su ogni comando
//! successivo»* — e quel «chi monta» era qui.
//!
//! Il difetto misurato non era che l'host paniasse: era che alla **stessa
//! domanda** — *cosa si fa quando questo lucchetto è avvelenato?* — i tre strati
//! rispondevano in tre modi, e nessuno dei tre stava scritto.
//!
//! - `crates/fub-host/src/runner.rs` scriveva `.expect("workspace avvelenato")`:
//!   sembra una decisione presa, ed è solo una frase.
//! - `crates/fub-app/src/lib.rs` scriveva `.unwrap()` nudo, quattordici volte:
//!   la stessa cosa detta per abitudine, senza nemmeno la frase.
//! - `crates/fub-host/src/config.rs` scriveva `.unwrap_or_else(|e|
//!   e.into_inner())`: **ricuperava**, ed è la risposta opposta.
//!
//! Il terzo è quello che ha reso la cosa decidibile, ed è rimasto dov'era: là il
//! lucchetto serializza due variabili d'ambiente in un test, e un panico dentro
//! quella sezione non lascia niente di storto perché non c'è niente da lasciare.
//! La politica non è dei lucchetti: è di **cosa il lucchetto protegge**.
//!
//! # La decisione: irrecuperabile, e detta una volta sola
//!
//! Un [`std::sync::RwLock`] si avvelena **solo** se a paniare è chi tiene il
//! prestito esclusivo (chi legge non lo avvelena, ed è metà del regalo della
//! [0024]). Quindi «avvelenato» qui non vuol dire «qualcuno è morto vicino»:
//! vuol dire *una mutazione si è fermata a metà*. Un [`fub_kernel::Workspace`]
//! preso a quel punto ha un indice alimentato per metà, un documento nella
//! tabella e non nel grafo, un lotto aperto che nessuno chiuderà. `into_inner`
//! restituirebbe quello stato e lo farebbe passare per buono: chi cerca
//! troverebbe risposte *sbagliate* invece di risposte *mancanti*, che è il modo
//! peggiore di sopravvivere. Ricuperare qui non è ricuperare — è mentire.
//!
//! Ma «irrecuperabile» non autorizza il panico ripetuto, che è ciò che
//! l'`unwrap` faceva: rendeva l'app **muta** a ogni chiamata successiva, senza
//! una riga che dicesse perché. Le due cose stanno insieme così:
//!
//! 1. **la prima volta** che una custodia risulta avvelenata scrive *una* riga
//!    di `tracing::error!` che dice cosa è successo, cosa non è più credibile e
//!    che va riavviato;
//! 2. **tutte le volte**, prima compresa, chi chiede riceve un
//!    [`PluginError::Internal`] con la stessa frase — che sull'IPC diventa un
//!    errore discriminabile e sullo schermo una frase, non un vuoto.
//!
//! Il conto delle denunce è di **questa** custodia e non del processo: due vault
//! aperti sono due stati, e sapere che il primo è morto non dice niente del
//! secondo. Si può chiedere ([`Custody::reports`]), e vale zero o uno per
//! sempre.
//!
//! # Perché una porta e non una convenzione
//!
//! Perché la risposta giusta è **una**, e una risposta che va ripetuta a ogni
//! `.lock()` futuro è la risposta sbagliata: il secondo chiamante la deve
//! ereditare gratis. Qui il `RwLock` è privato a questo modulo e non esce mai —
//! `read`/`write` consegnano la guardia o l'errore, e `.lock()` su una
//! [`Custody`] **non esiste**, quindi non compila. È la forma del `mod intake`
//! di `fub-kernel/src/bus.rs`.
//!
//! Che il tipo sia generico non è eleganza: è la prova. La seconda custodia —
//! il registro dei bundle, le bandiere dei job, le sveglie, gli scarti
//! dell'apertura, la mappa delle sessioni — non ha ridiscusso niente.
//!
//! Chi resta fuori sta in `crates/fub-host/tests/un_lucchetto_solo.rs`, che è il
//! conto: ogni `Mutex`/`RwLock` nudo di `fub-host` e `fub-app` vuole una riga
//! con la sua ragione.
//!
//! # E quanto a lungo lo si è tenuto
//!
//! La stessa porta risponde a una seconda domanda, che è quella della §27.3:
//! *questo prestito esclusivo quanto è durato?*. La regola dichiarata dei job —
//! un prestito per chiamata, mai per la durata del job — limita per quanto si
//! tiene il lucchetto **fra** le chiamate, non **dentro** una, e ciò che gira
//! dentro una non è tutto codice di casa: i venticinque metodi che il contratto
//! dichiara `&mut self` sono il posto da cui un provider di terzi entra tenendo
//! in mano il vault intero.
//!
//! Un prestito esclusivo lungo non si può interrompere — chi lo tiene ha `&mut`
//! su ciò che sta dentro, e togliergli il tavolo da sotto vorrebbe dire
//! esattamente lo stato a metà di cui sopra —, quindi ciò che si può fare non è
//! impedirlo: è **accorgersene e dirlo**, invece di restare fermi in silenzio.
//! Che è la differenza fra un'app rotta e un plugin lento, e oggi l'utente non
//! ha modo di distinguerle.
//!
//! Vale sul prestito **esclusivo** e non su quello condiviso, e non per
//! simmetria mancata: un condiviso non mette in fila gli altri condivisi, e
//! l'unico lungo che questo repo ha per scelta — la raccolta degli spazi
//! per-documento in fondo a un'apertura — è lungo *perché* è condiviso, cioè è
//! la riparazione e non il difetto.
//!
//! [0024]: ../../../docs/decisions/README.md
//! [0032]: ../../../docs/decisions/0183-composizione-host-kernel.md

use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::thread::ThreadId;
use std::time::{Duration, Instant};

use fub_abi::text::Text;
use fub_abi::PluginError;

use crate::waits;

/// Ogni quanto chi aspetta il turno **dal dentro di un componente** si ferma a
/// guardare se deve smettere (cancellazione) o se l'attesa ha chiuso un ciclo.
///
/// Non è una scadenza: il turno che si libera sveglia subito chi aspetta. È il
/// tempo massimo che un job annullato, o uno che deve cedere, impiega a
/// accorgersene. Un centesimo di secondo non si sente, e non fa girare a vuoto:
/// un'attesa normale è una condvar.
const YIELD_TICK: Duration = Duration::from_millis(10);

/// **Quanto può durare un prestito esclusivo prima che valga la pena dirlo.**
///
/// Non è una soglia di correttezza — niente si rompe a 249 ms e niente si
/// ripara a 251 —: è la durata oltre la quale chi guarda lo schermo smette di
/// leggere un'attesa come una risposta che sta arrivando e comincia a leggerla
/// come qualcosa che si è inceppato. Il numero misurato che questo repo ha
/// dall'altra parte è 0,12 ms per un salvataggio sotto contesa (decisione
/// 0024): fra i due c'è un fattore duemila, e nessuna mutazione di casa ci
/// arriva vicino per caso.
const TOO_SLOW: Duration = Duration::from_millis(250);

/// **Un dato condiviso dietro un lucchetto, con la politica del veleno dentro.**
///
/// Si clona come un `Arc` — è un `Arc` — e chi ne ha una copia ha lo stesso
/// dato. Il `RwLock` non esce: le uniche due porte sono [`Custody::read`] e
/// [`Custody::write`], che rispondono con la guardia o con la frase.
pub struct Custody<T> {
    inside: Arc<Inner<T>>,
}

#[derive(Default)]
struct WriterTurnState {
    owner: Option<ThreadId>,
    depth: usize,
}

struct Inner<T> {
    /// **Il lucchetto, e non esce di qui.** È l'intera ragione per cui questo
    /// tipo esiste: un campo privato di un modulo privato non si prende a mano.
    lock: RwLock<T>,
    /// Serializza i **turni di mutazione**, ma non le letture. Un turno può
    /// sopravvivere al rilascio del `RwLock` mentre gira codice esterno: così
    /// un provider non tiene `Custody<Workspace>` e, nello stesso tempo, un
    /// secondo writer non entra nel batch/attore lasciato aperto dal primo.
    writer_turn: Mutex<WriterTurnState>,
    writer_turn_ready: Condvar,
    /// Come si chiama ciò che sta dentro, quando bisogna dire che è morto.
    /// `&'static str` e non `String` perché è una costante del sito di
    /// costruzione: se un giorno servisse il path del vault, allora la frase la
    /// comporrebbe chi apre, e questo campo diventerebbe `Box<str>`.
    name: &'static str,
    /// Quante volte questa custodia ha **denunciato**, cioè scritto la riga.
    /// Zero o uno, per sempre. Vedi [`Custody::reports`].
    reports: AtomicU32,
    /// Oltre quanto un prestito esclusivo è **lungo**. È un campo e non la
    /// costante letta a ogni giro perché un banco che prova la proprietà non
    /// deve dormire un quarto di secondo per vederla: la soglia è ciò che si
    /// muove, la proprietà no.
    threshold: Duration,
    /// Quanti prestiti esclusivi hanno passato la soglia. A differenza delle
    /// denunce **cresce**: un veleno è uno stato e si dice una volta, una
    /// lentezza è un fatto e ne può capitare un altro. Vedi
    /// [`Custody::slow_count`].
    slow_count: AtomicU32,
}

impl<T> Clone for Custody<T> {
    fn clone(&self) -> Self {
        Custody {
            inside: Arc::clone(&self.inside),
        }
    }
}

impl<T: std::fmt::Debug> std::fmt::Debug for Custody<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Custody")
            .field("name", &self.inside.name)
            .field("reports", &self.reports())
            .finish_non_exhaustive()
    }
}

impl<T> Custody<T> {
    /// Mette `value` in custodia. `name` è ciò che comparirà nella frase quando
    /// questa custodia risulterà avvelenata: va scritto per chi la legge sullo
    /// schermo, non per chi cerca il simbolo nel sorgente.
    pub fn new(name: &'static str, value: T) -> Self {
        Custody::with_threshold(name, value, TOO_SLOW)
    }

    /// La stessa, con un'altra idea di **quanto è lungo**.
    ///
    /// Esiste perché la proprietà che [`TOO_SLOW`] compra si possa
    /// provare senza pagarla: un banco che la vuole vedere mette una soglia di
    /// un millesimo e tiene il prestito per cinque, invece di dormire un quarto
    /// di secondo per ogni riga che prova. È la stessa ragione per cui
    /// [`reports`](Custody::denunce) è pubblica — una proprietà che nessuno
    /// può chiedere è una promessa.
    pub fn with_threshold(name: &'static str, value: T, threshold: Duration) -> Self {
        Custody {
            inside: Arc::new(Inner {
                lock: RwLock::new(value),
                writer_turn: Mutex::new(WriterTurnState::default()),
                writer_turn_ready: Condvar::new(),
                name,
                reports: AtomicU32::new(0),
                threshold,
                slow_count: AtomicU32::new(0),
            }),
        }
    }

    /// Il prestito **condiviso**. Chi legge non avvelena niente: se questa
    /// risponde di no è perché qualcun altro, prima, è morto scrivendo.
    pub fn read(&self) -> Result<RwLockReadGuard<'_, T>, PluginError> {
        match self.inside.lock.read() {
            Ok(g) => Ok(g),
            Err(_) => Err(self.report()),
        }
    }

    /// Prenota il **turno di scrittura** senza prendere il dato in esclusiva.
    ///
    /// Il turno è rientrante per il thread che lo possiede: una callback può
    /// quindi rientrare attraverso un host che prende `write()` per una singola
    /// capacità. Gli altri writer aspettano il turno; i reader non lo guardano
    /// e continuano a progredire mentre il callback gira fuori dal `RwLock`.
    ///
    /// **Non può dire di no**, quindi non è la porta di chi sta dentro il codice
    /// di un componente: un guest che tiene la sua istanza e aspetta il turno di
    /// un salvataggio che aspetta quell'istanza non si sbloccherebbe mai. Per
    /// quello c'è [`write_turn_yielding`](Self::write_turn_yielding), che cede.
    pub fn write_turn(&self) -> WriteTurn<'_, T> {
        match self.acquire_turn(None) {
            Ok(turn) => turn,
            Err(_) => unreachable!("senza una verifica di cessione l'attesa non fallisce"),
        }
    }

    /// Il turno di scrittura per chi sta **dentro un componente**: aspetta, ma
    /// non per sempre, e può rinunciare.
    ///
    /// Mentre aspetta, a ogni giro (ogni [`YIELD_TICK`], o prima se il turno si
    /// libera):
    ///
    /// 1. chiede a `stopped` se deve smettere — la cancellazione del job, che
    ///    prima non poteva interrompere un'attesa nativa;
    /// 2. se tiene un'istanza e chi ha il turno aspetta quell'istanza (di
    ///    seguito, magari attraverso altri thread), rinuncia con un
    ///    [`PluginError::Conflict`]: il turno è tenuto *attraverso* il codice dei
    ///    provider (decisione 0120), quindi l'unico modo di sciogliere il ciclo
    ///    è che chi sta dentro il guest esca e restituisca l'istanza. Vedi
    ///    [`crate::waits`] per perché è sempre lui a cedere e non il
    ///    salvataggio.
    ///
    /// `stopped` gira **sotto il registro del turno**: deve essere istantanea e
    /// non prendere lucchetti (leggere una bandiera atomica).
    pub fn write_turn_yielding(
        &self,
        stopped: &dyn Fn() -> Result<(), PluginError>,
    ) -> Result<WriteTurn<'_, T>, PluginError> {
        self.acquire_turn(Some(stopped))
    }

    /// Il turno, con o senza la facoltà di rinunciare.
    fn acquire_turn(
        &self,
        stopped: Option<&dyn Fn() -> Result<(), PluginError>>,
    ) -> Result<WriteTurn<'_, T>, PluginError> {
        let me = std::thread::current().id();
        let mut state = self
            .inside
            .writer_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut waiting: Option<waits::TurnWait> = None;
        loop {
            match state.owner {
                None => {
                    state.owner = Some(me);
                    state.depth = 1;
                    return Ok(WriteTurn::new(&self.inside));
                }
                Some(owner) if owner == me => {
                    state.depth += 1;
                    return Ok(WriteTurn::new(&self.inside));
                }
                Some(owner) => {
                    let Some(stopped) = stopped else {
                        state = self
                            .inside
                            .writer_turn_ready
                            .wait(state)
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        continue;
                    };
                    stopped()?;
                    match waiting.as_ref() {
                        Some(wait) => wait.now_owned_by(owner),
                        None => waiting = Some(waits::wait_turn(owner)),
                    }
                    if waits::closes_cycle(owner) {
                        return Err(PluginError::Conflict(Text::message(
                            "host.turn.cycle",
                            vec![],
                        )));
                    }
                    state = self
                        .inside
                        .writer_turn_ready
                        .wait_timeout(state, YIELD_TICK)
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .0;
                }
            }
        }
    }

    /// Il turno di scrittura è in mano a qualcuno **in questo istante**?
    ///
    /// Non lo prende e non aspetta: legge di chi è. Serve a un banco che deve
    /// fissare l'ordine fra due thread senza orologio — «il salvataggio ha il
    /// turno» è un fatto che si può aspettare, «è passato abbastanza tempo» no.
    pub fn writer_turn_held(&self) -> bool {
        self.inside
            .writer_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .owner
            .is_some()
    }

    /// Come [`write_turn`](Self::write_turn), ma senza mettersi in fila.
    fn try_write_turn(&self) -> Option<WriteTurn<'_, T>> {
        let me = std::thread::current().id();
        let mut state = self.inside.writer_turn.try_lock().ok()?;
        match state.owner.as_ref() {
            None => {
                state.owner = Some(me);
                state.depth = 1;
                Some(WriteTurn::new(&self.inside))
            }
            Some(owner) if owner == &me => {
                state.depth += 1;
                Some(WriteTurn::new(&self.inside))
            }
            Some(_) => None,
        }
    }

    /// Il prestito **esclusivo**. Chi lo prende e pania è chi avvelena: è il
    /// caso che questa politica descrive.
    pub fn write(&self) -> Result<Hold<'_, T>, PluginError> {
        // Chi tiene un'istanza sta eseguendo un componente: per lui l'attesa del
        // turno può chiudere un ciclo, e `write` ha un esito per dirlo.
        let turn = if waits::holds_instance() {
            self.write_turn_yielding(&|| Ok(()))?
        } else {
            self.write_turn()
        };
        match self.inside.lock.write() {
            Ok(g) => Ok(Hold::new(g, &self.inside, turn)),
            Err(_) => Err(self.report()),
        }
    }

    /// Il prestito condiviso **senza mettersi in fila**: `None` se in questo
    /// istante non lo si può avere, per qualunque ragione — qualcuno scrive, o
    /// la custodia è morta.
    ///
    /// Le due ragioni non si distinguono di proposito: chi chiede «lo posso
    /// avere adesso?» sta misurando la contesa, e per lui «no» è uno solo. Chi
    /// vuole sapere *perché* usa [`read`](Custody::read), che aspetta e
    /// risponde.
    pub fn try_read(&self) -> Option<RwLockReadGuard<'_, T>> {
        self.inside.lock.try_read().ok()
    }

    /// Il prestito esclusivo **senza mettersi in fila**. Vedi
    /// [`try_read`](Custody::try_read) per perché il «no» è uno solo.
    pub fn try_write(&self) -> Option<Hold<'_, T>> {
        let turn = self.try_write_turn()?;
        self.inside
            .lock
            .try_write()
            .ok()
            .map(|g| Hold::new(g, &self.inside, turn))
    }

    /// Sono la **stessa** custodia? Serve a chi prova che riaprire un vault
    /// già aperto non lo riapre: la domanda è sull'identità del dato, non sul
    /// suo contenuto.
    pub fn ptr_eq(a: &Self, b: &Self) -> bool {
        Arc::ptr_eq(&a.inside, &b.inside)
    }

    /// **Quante volte questa custodia ha scritto la riga**: zero finché è viva,
    /// uno da quando è morta, e uno per sempre.
    ///
    /// È pubblica perché è la proprietà che questa decisione compra, e una
    /// proprietà che nessuno può chiedere è una promessa. La misura
    /// `crates/fub-host/tests/un_lucchetto_solo.rs`.
    pub fn reports(&self) -> u32 {
        self.inside.reports.load(Ordering::Relaxed)
    }

    /// **Quanti prestiti esclusivi sono durati più della soglia.** È la
    /// proprietà che la §27.3 compra, e per la ragione scritta accanto a
    /// [`reports`](Custody::denunce) si può chiedere.
    pub fn slow_count(&self) -> u32 {
        self.inside.slow_count.load(Ordering::Relaxed)
    }

    /// La frase, e — la prima volta soltanto — la riga nel log.
    ///
    /// Un atomico e non un [`std::sync::Once`], che pure saprebbe fare la parte
    /// del «una volta sola»: `Once` esegue la chiusura sotto un lucchetto suo, e
    /// mettere un lucchetto dentro la risposta a *«un lucchetto è andato
    /// storto»* è il modo di scoprire un giorno che la via d'uscita si può
    /// bloccare. Qui la risposta è una parola e un `compare_exchange`, e non può
    /// aspettare nessuno.
    #[cold]
    fn report(&self) -> PluginError {
        if self
            .inside
            .reports
            .compare_exchange(0, 1, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            tracing::error!(
                target: "fub.host",
                "{}: un panico ha interrotto una modifica a metà mentre teneva il lucchetto. \
                 Ciò che ne resta in memoria non è uno stato che qualcuno abbia scritto — un \
                 indice alimentato a metà, un lotto che nessuno chiuderà — e riusarlo darebbe \
                 risposte sbagliate invece che mancanti. Da qui in poi ogni chiamata che passa \
                 di qui risponde di no invece di paniare: i dati sul disco non sono toccati, \
                 riavvia Fub. Il panico che lo ha causato è stato riportato dove è successo.",
                self.inside.name,
            );
        }
        // Le volte dopo non scrivono niente: la riga è una diagnosi, e una
        // diagnosi ripetuta a ogni chiamata è rumore che copre la prima.
        PluginError::Internal(
            format!(
                "{}: stato irrecuperabile — un panico ha interrotto una modifica a metà, e ciò \
                 che resta in memoria non è credibile. I file sul disco non sono toccati: \
                 riavvia Fub.",
                self.inside.name
            )
            .into(),
        )
    }
}

impl<T> Inner<T> {
    /// La riga — la prima volta soltanto — e il conto, sempre.
    ///
    /// «La prima volta soltanto» è la stessa regola del veleno e per la stessa
    /// ragione: una diagnosi ripetuta a ogni giro è rumore che copre la prima,
    /// e chi vuole sapere se è successo ancora ha il conto, che invece cresce.
    #[cold]
    fn slowness(&self, duration: Duration) {
        if self.slow_count.fetch_add(1, Ordering::Relaxed) == 0 {
            tracing::warn!(
                target: "fub.host",
                "{}: una modifica ha tenuto il prestito esclusivo per {} ms. Finché lo teneva, \
                 ogni lettura e ogni salvataggio su questo vault erano fermi ad aspettarla: \
                 sullo schermo è un'app che non risponde, e non lo è — è una singola operazione \
                 lenta. Se si ripete, chi la fa va spostato in un job, che il prestito lo prende \
                 e lo rilascia a ogni capacità invece di tenerlo per tutta la durata del lavoro.",
                self.name,
                duration.as_millis(),
            );
        }
    }
}

/// Il turno di un writer, separato dal prestito esclusivo del dato.
///
/// Non è `Send`: la rientranza è definita dall'identità del thread e il turno
/// deve essere lasciato dallo stesso thread che l'ha preso.
pub struct WriteTurn<'a, T> {
    inside: &'a Inner<T>,
    _not_send: PhantomData<Rc<()>>,
}

impl<'a, T> WriteTurn<'a, T> {
    fn new(inside: &'a Inner<T>) -> Self {
        Self {
            inside,
            _not_send: PhantomData,
        }
    }
}

impl<T> Drop for WriteTurn<'_, T> {
    fn drop(&mut self) {
        let me = std::thread::current().id();
        let mut state = self
            .inside
            .writer_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        debug_assert_eq!(state.owner.as_ref(), Some(&me));
        debug_assert!(state.depth > 0);
        state.depth -= 1;
        if state.depth == 0 {
            state.owner = None;
            drop(state);
            self.inside.writer_turn_ready.notify_one();
        }
    }
}

/// **Il prestito esclusivo, e per quanto lo si è tenuto.**
///
/// Si usa come la guardia che avvolge — `*presa`, `presa.metodo()` — e l'unica
/// cosa che aggiunge la fa sciogliendosi: guarda l'orologio, e se il prestito è
/// durato più della soglia della custodia lo dice.
///
/// Il lucchetto si **rilascia prima** di scrivere la riga, e non è un dettaglio
/// di stile: il campo si scioglie dopo il corpo del [`Drop`], quindi lasciandolo
/// dov'era la diagnosi di un prestito troppo lungo si sarebbe scritta tenendolo,
/// cioè allungando esattamente ciò che sta misurando.
pub struct Hold<'a, T> {
    /// `Option` per poterlo sciogliere **prima** della riga: vedi sopra. Vale
    /// `Some` per tutta la vita della presa e `None` solo dentro il [`Drop`].
    guard: Option<RwLockWriteGuard<'a, T>>,
    turn: Option<WriteTurn<'a, T>>,
    inside: &'a Inner<T>,
    taken: Instant,
}

impl<'a, T> Hold<'a, T> {
    fn new(guard: RwLockWriteGuard<'a, T>, inside: &'a Inner<T>, turn: WriteTurn<'a, T>) -> Self {
        Hold {
            guard: Some(guard),
            turn: Some(turn),
            inside,
            // Dopo l'acquisizione e non prima: ciò che si misura è per quanto
            // **si tiene**, non per quanto si è aspettato di avere. Chi ha
            // aspettato è la vittima, e il suo conto lo tiene la presa
            // dell'altro.
            taken: Instant::now(),
        }
    }
}

impl<T> Deref for Hold<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.guard
            .as_ref()
            .expect("the hold lives until it unwinds")
    }
}

impl<T> DerefMut for Hold<'_, T> {
    fn deref_mut(&mut self) -> &mut T {
        self.guard
            .as_mut()
            .expect("the hold lives until it unwinds")
    }
}

impl<T> Drop for Hold<'_, T> {
    fn drop(&mut self) {
        let duration = self.taken.elapsed();
        drop(self.guard.take());
        drop(self.turn.take());
        if duration >= self.inside.threshold {
            self.inside.slowness(duration);
        }
    }
}

impl<T: Default> Custody<T> {
    /// Comodità per chi mette in custodia un dato che nasce vuoto.
    pub fn empty(name: &'static str) -> Self {
        Custody::new(name, T::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Avvelena la custodia come la avvelena la vita: un thread che pania
    /// tenendo il prestito **esclusivo**.
    ///
    /// Il panico è di proposito e non deve sporcare l'output del banco: l'hook
    /// si mette a tacere per la durata del misfatto e si rimette subito.
    fn poison<T: Send + Sync + 'static>(c: &Custody<T>) {
        let copy = c.clone();
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::thread::spawn(move || {
            let _g = copy.write().expect("alive before the misdeed");
            panic!("halfway");
        })
        .join();
        std::panic::set_hook(hook);
    }

    #[test]
    fn alive_does_not_report_and_allows_access() {
        let c = Custody::new("the counter", 1_u32);
        *c.write().expect("exclusive borrow") += 1;
        assert_eq!(*c.read().expect("shared borrow"), 2);
        assert_eq!(c.reports(), 0, "a live custody has nothing to say");
    }

    #[test]
    fn poisoned_says_no_instead_of_panicking() {
        let c = Custody::new("the test vault", 1_u32);
        poison(&c);
        // Il punto della decisione: **non** un panico, né alla prima né alla
        // decima. Se questo tornasse un `unwrap`, questo test non fallirebbe:
        // abortirebbe il thread del banco — che è precisamente ciò che
        // succedeva all'utente a ogni IPC.
        for _ in 0..10 {
            assert!(c.read().is_err(), "read from dead");
            assert!(c.write().is_err(), "write from dead");
        }
    }

    #[test]
    fn the_sentence_names_what_died_and_mentions_disk() {
        let c = Custody::new("the test vault", 1_u32);
        poison(&c);
        let PluginError::Internal(phrase) = c.read().expect_err("dead") else {
            panic!("a poison is not a domain error: it is a host fault");
        };
        let phrase = phrase.to_string();
        assert!(phrase.contains("the test vault"), "{phrase}");
        assert!(phrase.contains("disco"), "what was NOT lost: {phrase}");
        assert!(phrase.contains("riavvia"), "what must be done: {phrase}");
    }

    #[test]
    fn the_line_is_written_only_once() {
        let c = Custody::new("the test vault", 1_u32);
        poison(&c);
        assert_eq!(c.reports(), 0, "while nobody asks, nothing to say");
        for _ in 0..50 {
            drop(c.read());
            drop(c.write());
        }
        assert_eq!(
            c.reports(),
            1,
            "a hundred calls and one line: that is half the bug that 0120 fixes"
        );
    }

    /// **Un prestito esclusivo troppo lungo si dice** (§27.3).
    ///
    /// La soglia si abbassa invece di dormirci sopra: ciò che si prova è che
    /// la porta guarda l'orologio e parla, non quanto vale il quarto di secondo
    /// di [`TOO_SLOW`].
    #[test]
    fn a_mutation_holding_the_vault_too_long_is_reported() {
        let c = Custody::with_threshold("the test vault", 1_u32, Duration::from_millis(1));
        {
            let mut g = c.write().expect("exclusive borrow");
            *g += 1;
            std::thread::sleep(Duration::from_millis(8));
        }
        assert_eq!(
            c.slow_count(),
            1,
            "the borrow lasted longer than the threshold and nobody said so: it is the wait \
             that looks like a frozen app on screen"
        );
        assert_eq!(*c.read().expect("alive"), 2, "and the mutation happened");
        assert_eq!(c.reports(), 0, "slow does not mean dead");
    }

    /// L'altra metà, che impedisce alla riparazione di diventare «ogni prestito
    /// è lento»: una mutazione normale non dice niente. Ed è anche la ragione
    /// per cui la misura parte **dopo** l'acquisizione — qui il secondo
    /// prestito ha aspettato il primo, e ad averlo tenuto non è lui.
    #[test]
    fn a_normal_borrow_says_nothing() {
        let c = Custody::with_threshold("the test vault", 1_u32, Duration::from_millis(50));
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|s| {
            s.spawn(|| {
                let _g = c.write().expect("exclusive borrow");
                barrier.wait();
                std::thread::sleep(Duration::from_millis(2));
            });
            barrier.wait();
            let _g = c.write().expect("the second waits for the first");
        });
        assert_eq!(
            c.slow_count(),
            0,
            "the one who waited is not the one who held: measurement starts at acquisition"
        );
    }

    /// E la riga è una, come quella del veleno — ma il conto no, perché una
    /// lentezza è un fatto e non uno stato: ne può capitare un'altra.
    #[test]
    fn the_line_is_one_but_the_count_grows() {
        let c = Custody::with_threshold("the test vault", 1_u32, Duration::from_millis(1));
        for _ in 0..3 {
            let _g = c.write().expect("exclusive borrow");
            std::thread::sleep(Duration::from_millis(4));
        }
        assert_eq!(c.slow_count(), 3, "three facts, three in the count");
    }

    #[test]
    fn two_custodies_are_two_states() {
        let live: Custody<u32> = Custody::new("the second vault", 7);
        let dead: Custody<u32> = Custody::new("the first vault", 1);
        poison(&dead);
        assert!(dead.read().is_err());
        assert_eq!(
            *live
                .read()
                .expect("the second vault has nothing to do with it"),
            7,
            "the poison belongs to the datum, not the process"
        );
        assert_eq!(live.reports(), 0);
    }

    #[test]
    fn a_copy_is_the_same_state() {
        let c: Custody<u32> = Custody::new("the test vault", 1);
        let copy = c.clone();
        poison(&c);
        assert!(copy.read().is_err(), "cloning is not duplicating");
        drop(c.read());
        drop(copy.read());
        assert_eq!(copy.reports(), 1, "one line, not one per copy");
    }

    // -----------------------------------------------------------------------
    // Il turno di chi sta dentro un componente (FUB-019)
    // -----------------------------------------------------------------------

    /// Il thread di un salvataggio: prende il turno, poi aspetta l'istanza
    /// `token` come farebbe chiamando il parser. Si ferma lì finché il banco non
    /// lo lascia andare, e dice quando è arrivato a quel punto.
    ///
    /// Il salvataggio è fatto così **a mano** perché ciò che si prova è la
    /// custodia, non un componente: la prova con un componente vero sta in
    /// `fub-wasm-host/tests/the_instance_and_the_turn.rs`.
    fn a_save_waiting_for_an_instance(
        c: &Custody<u32>,
        token: usize,
    ) -> (std::sync::mpsc::Sender<()>, std::thread::JoinHandle<()>) {
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let copy = c.clone();
        let handle = std::thread::spawn(move || {
            let _turn = copy.write_turn();
            let _wait = waits::wait_instance(token);
            ready_tx.send(()).expect("il banco aspetta");
            let _ = release_rx.recv();
        });
        ready_rx
            .recv()
            .expect("il salvataggio ha il turno e aspetta");
        (release_tx, handle)
    }

    fn is_cycle(error: &PluginError) -> bool {
        matches!(
            error,
            PluginError::Conflict(Text::Message(message)) if message.key == "host.turn.cycle"
        )
    }

    #[test]
    fn a_yielding_turn_waits_for_a_free_turn_when_nothing_is_circular() {
        let c = Custody::new("the test vault", 1_u32);
        let (release, save) = a_save_waiting_for_an_instance(&c, 0xC0);
        // Il banco non tiene nessuna istanza: l'attesa del turno non chiude
        // niente, e il turno che si libera arriva a chi lo aspetta.
        std::thread::scope(|s| {
            let waiter = s.spawn(|| c.write_turn_yielding(&|| Ok(())).map(|_turn| ()));
            release.send(()).expect("il salvataggio c'è");
            assert!(waiter.join().expect("il thread").is_ok());
        });
        save.join().expect("il salvataggio finisce");
    }

    #[test]
    fn a_yielding_turn_gives_up_instead_of_closing_a_cycle() {
        let c = Custody::new("the test vault", 1_u32);
        // Questo thread è «il job»: tiene l'istanza 0xC1, che il salvataggio sta
        // aspettando mentre tiene il turno che il job sta per chiedere.
        let _held = waits::hold_instance(0xC1);
        let (release, save) = a_save_waiting_for_an_instance(&c, 0xC1);

        let outcome = c.write_turn_yielding(&|| Ok(()));
        assert!(
            outcome.as_ref().err().is_some_and(is_cycle),
            "il job doveva cedere con un conflitto, non aspettare per sempre"
        );
        drop(outcome);

        // Cedere non ha tolto niente a nessuno: il salvataggio riparte, e il
        // turno, libero, torna prendibile.
        release.send(()).expect("il salvataggio c'è");
        save.join().expect("il salvataggio finisce");
        assert!(
            c.write_turn_yielding(&|| Ok(())).is_ok(),
            "senza il salvataggio non c'è più ciclo"
        );
    }

    #[test]
    fn the_exclusive_borrow_of_a_component_yields_too() {
        let c = Custody::new("the test vault", 1_u32);
        let _held = waits::hold_instance(0xC2);
        let (release, save) = a_save_waiting_for_an_instance(&c, 0xC2);

        // `write()` è la porta di ogni capacità del vault di un job: chi sta
        // dentro un'istanza non deve potersi fermare lì dentro.
        let outcome = c.write();
        assert!(
            outcome.as_ref().err().is_some_and(is_cycle),
            "la capacità doveva rispondere di no, non pendere"
        );
        drop(outcome);

        release.send(()).expect("il salvataggio c'è");
        save.join().expect("il salvataggio finisce");
        assert_eq!(*c.write().expect("libero"), 1);
    }

    #[test]
    fn a_borrow_outside_a_component_waits_even_when_somebody_else_cycles() {
        let c = Custody::new("the test vault", 1_u32);
        // Il salvataggio aspetta un'istanza che **nessuno** tiene. Chi non è
        // dentro un componente non cede mai: aspetta il turno, com'è sempre
        // stato.
        let (release, save) = a_save_waiting_for_an_instance(&c, 0xC3);
        std::thread::scope(|s| {
            let waiter = s.spawn(|| c.write().map(|g| *g));
            release.send(()).expect("il salvataggio c'è");
            assert_eq!(
                waiter.join().expect("il thread").expect("il turno arriva"),
                1
            );
        });
        save.join().expect("il salvataggio finisce");
    }

    #[test]
    fn a_yielding_turn_stops_waiting_when_the_job_is_cancelled() {
        let c = Custody::new("the test vault", 1_u32);
        let _turn = c.write_turn();
        let cancelled = std::sync::atomic::AtomicBool::new(false);
        let stopped = || {
            if cancelled.load(Ordering::Relaxed) {
                Err(PluginError::Cancelled("annullato".into()))
            } else {
                Ok(())
            }
        };
        std::thread::scope(|s| {
            // Il turno è del banco per tutto il tempo: chi aspetta non può
            // riuscire, quindi se torna è perché ha visto la bandiera.
            let waiter = s.spawn(|| c.write_turn_yielding(&stopped).map(|_turn| ()));
            cancelled.store(true, Ordering::Relaxed);
            let outcome = waiter.join().expect("il thread");
            assert!(
                matches!(outcome, Err(PluginError::Cancelled(_))),
                "il job annullato doveva smettere di mettersi in fila: {outcome:?}"
            );
        });
    }

    #[test]
    fn a_yielding_turn_is_reentrant_and_does_not_ask_whether_to_stop() {
        let c = Custody::new("the test vault", 1_u32);
        let _outer = c.write_turn();
        // Chi ha già il turno non aspetta nessuno, quindi non ha niente da
        // cedere: nemmeno se la sua bandiera è già alzata.
        let inner = c.write_turn_yielding(&|| Err(PluginError::Cancelled("annullato".into())));
        assert!(inner.is_ok(), "il turno rientra senza chiedere permesso");
    }
}
