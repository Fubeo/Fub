//! Il dispatcher: **la coda, il budget e l'origine** — cioè tutto ciò che
//! decide *quando* un evento parte, *con che nome* e *fino a quando* si
//! continua a consegnarne.
//!
//! È uno dei cinque componenti in cui il §8.1 scompone il `Workspace`, e mette
//! insieme tre cose che il piano nominava separate perché sono la stessa: il
//! lotto ([decisione 0011](../../../docs/decisions/0011-il-lotto.md)) decide
//! *cosa esce*, l'origine
//! ([decisione 0012](../../../docs/decisions/0012-origine-degli-eventi.md))
//! decide *a nome di chi*, il budget decide *per quanto*. Tutte e tre si
//! applicano nello stesso punto — `Dispatcher::emit` — e tenerle in tre posti
//! significherebbe avere tre posti da cui un evento può uscire senza lotto,
//! senza attribuzione o senza freno.
//!
//! # Cosa **non** sta qui
//!
//! La consegna vera e propria. `deliver_to_handlers` chiama un provider, e un
//! provider vuole un `&mut Workspace` da prestare come `HostApi`: è
//! orchestrazione, e resta sul `Workspace`. Il taglio passa fra *decidere cosa
//! consegnare* (qui, con `Dispatcher::next_to_deliver`, che è dove vivono il
//! budget e l'`Overflow`) e *consegnarlo* (là). Il ciclo di drenaggio sul
//! `Workspace` non conta nulla e non decide nulla: chiede il prossimo e lo
//! passa agli handler.
//!
//! Per la stessa ragione le due guardie di stato — l'attore corrente e il flag
//! `in_provider_call` — qui sono coppie *scambia/ripristina*
//! (`Dispatcher::swap_actor`, `Dispatcher::enter_provider_call`) e non
//! funzioni che prendono una chiusura: la chiusura vorrebbe `&mut Workspace`,
//! che è esattamente ciò che questo componente non deve avere.

use std::collections::VecDeque;

use fubmd_abi::model::DocId;
use fubmd_abi::traits::{JobId, JobSpec};
use fubmd_abi::{Actor, BatchId, Event, Notice, Origin};

use crate::bus::EventBus;

/// Tetto di eventi drenati in un singolo drenaggio: tronca i cicli di handler
/// che si rimbalzano eventi a vicenda senza convergere. Il troncamento NON è
/// silenzioso: emette [`Event::Overflow`] (bus + handler), così chi deriva
/// stato dagli eventi sa di dover riconciliare da zero.
const DISPATCH_BUDGET: usize = 1024;

/// Un lotto aperto: la sua identità e cosa ha toccato.
struct BatchState {
    id: BatchId,
    /// I documenti toccati, in ordine di prima apparizione e senza ripetizioni:
    /// è l'elenco che finirà in [`Event::BatchEnded`], ed è ciò che l'utente
    /// vedrebbe se glielo si mostrasse — quindi l'ordine è quello in cui le cose
    /// sono successe, non quello di una `HashSet`.
    changed: Vec<DocId>,
    /// Almeno un [`Event::IndexUpdated`] è stato soppresso: alla chiusura il
    /// lotto ha qualcosa da dire anche se non ha toccato documenti (una
    /// rimozione dal solo indice, un rebuild).
    index_dirty: bool,
}

/// Cosa il dispatcher chiede di consegnare adesso.
pub(crate) enum ToDeliver {
    /// Un evento della coda, con il budget ancora capiente.
    Notice(Notice),
    /// Il budget è finito. Questo `Overflow` è l'**ultima** consegna del
    /// drenaggio: ciò che gli handler emettono gestendolo è già stato scartato,
    /// perché è l'unico modo di garantire la terminazione.
    Overflow(Notice),
}

pub struct Dispatcher {
    bus: EventBus,
    /// Eventi in attesa di dispatch verso gli handler, ognuno con l'origine
    /// che aveva **al momento dell'emissione** — non quella del drenaggio, che
    /// può avvenire sotto un altro attore.
    pending: VecDeque<Notice>,
    /// Guardia anti-rientranza: un drenaggio non si annida mai.
    dispatching: bool,
    /// Siamo dentro una chiamata a un provider (view `on_action`, `handle`,
    /// `flush`, `activate`, `invoke`)? Finché è alzato, il dispatch è
    /// rimandato: gli eventi arrivano **dopo che la chiamata del provider è
    /// tornata**, mai dentro il suo frame. È la semantica che il component
    /// model impone a M5 (un'istanza non è rientrante: un plugin che è sia
    /// view sia handler trapperebbe), promossa a contratto già in nativo.
    in_provider_call: bool,
    /// Job richiesti via `HostEvents::spawn_job`, in attesa che l'host li
    /// esegua fuori dal giro sincrono.
    pending_jobs: Vec<PendingJob>,
    /// Contatore per l'assegnazione dei [`JobId`].
    next_job_id: u64,
    /// Chi ha **chiesto** ciò che il workspace sta facendo adesso: è l'attore
    /// che finisce sull'origine di ogni evento emesso da qui in poi. Il valore
    /// a riposo è [`Actor::User`] perché a riposo il kernel è chiamato dalla
    /// shell.
    actor: Actor,
    /// Il lotto aperto, se c'è. Uno solo: chi trova il campo pieno non lo
    /// tocca, e a chiudere è solo chi lo ha riempito.
    batch: Option<BatchState>,
    /// Contatore per l'assegnazione dei [`BatchId`].
    next_batch_id: u64,
}

impl Dispatcher {
    pub(crate) fn new(bus: EventBus) -> Self {
        Self {
            bus,
            pending: VecDeque::new(),
            dispatching: false,
            in_provider_call: false,
            pending_jobs: Vec::new(),
            next_job_id: 0,
            actor: Actor::User,
            batch: None,
            next_batch_id: 0,
        }
    }

    /// Il ponte verso i subscriber esterni (frontend, watcher).
    pub fn bus(&self) -> &EventBus {
        &self.bus
    }

    // --- emissione ---------------------------------------------------------

    /// Unico punto di emissione: ponte verso i subscriber esterni + coda per
    /// gli handler registrati.
    ///
    /// È anche il punto unico in cui l'origine viene apposta e in cui il lotto
    /// fa il proprio lavoro. Che siano la stessa riga non è economia: un
    /// secondo posto da cui emettere sarebbe un posto da cui uscire senza
    /// origine o fuori dal lotto, e un evento non attribuito è indistinguibile
    /// da uno attribuito male.
    pub(crate) fn emit(&mut self, event: Event) {
        // Dentro un lotto `index-updated` non esce: N copie di un evento senza
        // payload dicono quanto ne dice una, e alla chiusura il `batch-ended`
        // dice quella e in più *quali* documenti. È l'unico evento che il lotto
        // coalizza — vedi il doc di `fubmd_abi::event`.
        if let Some(state) = self.batch.as_mut() {
            if matches!(event, Event::IndexUpdated) {
                state.index_dirty = true;
                return;
            }
            if let Some(doc) = event.touched() {
                if !state.changed.contains(doc) {
                    state.changed.push(doc.clone());
                }
            }
        }
        let notice = Notice::new(event, self.origin());
        self.bus.emit(notice.clone());
        self.pending.push_back(notice);
    }

    /// L'origine di ciò che il workspace sta emettendo adesso.
    fn origin(&self) -> Origin {
        Origin::by(self.actor.clone()).in_batch(self.batch.as_ref().map(|b| b.id))
    }

    // --- attore ------------------------------------------------------------

    /// Installa `actor` e rende quello di prima, che il chiamante deve
    /// rimettere con [`Dispatcher::restore_actor`].
    ///
    /// È una coppia e non una funzione con chiusura perché la chiusura vorrebbe
    /// `&mut Workspace`: l'attore è **chi ha chiesto**, non chi esegue, e chi
    /// lo alza (il watcher, il dispatch verso un handler, `invoke_command`)
    /// sta orchestrando — cioè sta sul `Workspace`.
    pub(crate) fn swap_actor(&mut self, actor: Actor) -> Actor {
        std::mem::replace(&mut self.actor, actor)
    }

    pub(crate) fn restore_actor(&mut self, actor: Actor) {
        self.actor = actor;
    }

    // --- lotto -------------------------------------------------------------

    /// Apre un lotto se non ce n'è già uno. Rende `true` se lo ha aperto —
    /// cioè se chi chiama è anche chi dovrà chiuderlo.
    ///
    /// Annidato, non apre un secondo lotto: chiudere quello interno farebbe
    /// arrivare un `batch-ended` mentre l'operazione esterna è ancora in corso.
    /// Per questo non serve contare le aperture.
    pub(crate) fn open_batch(&mut self) -> bool {
        if self.batch.is_some() {
            return false;
        }
        let id = BatchId(self.next_batch_id);
        self.next_batch_id += 1;
        self.batch = Some(BatchState {
            id,
            changed: Vec::new(),
            index_dirty: false,
        });
        true
    }

    /// Chiude il lotto più esterno accodando il terminale, se ha qualcosa da
    /// dire. **Non drena**: drenare vuol dire consegnare, e consegnare è del
    /// `Workspace`.
    pub(crate) fn close_batch(&mut self) {
        let Some(state) = self.batch.take() else {
            return;
        };
        if !state.index_dirty && state.changed.is_empty() {
            return;
        }
        // Il terminale si costruisce a mano invece di passare da `emit`: la sua
        // origine porta il lotto che sta **chiudendo** (è l'evento *del* lotto,
        // non uno che arriva dopo), e passare dal punto unico significherebbe o
        // riaprire il lotto per una riga o emetterlo orfano.
        let notice = Notice::new(
            Event::BatchEnded {
                batch: state.id,
                changed: state.changed,
            },
            Origin::by(self.actor.clone()).in_batch(Some(state.id)),
        );
        self.bus.emit(notice.clone());
        self.pending.push_back(notice);
    }

    // --- chiamata a un provider --------------------------------------------

    /// Alza il flag `in_provider_call` e rende il valore di prima, che il
    /// chiamante deve rimettere con [`Dispatcher::restore_provider_call`].
    pub(crate) fn enter_provider_call(&mut self) -> bool {
        std::mem::replace(&mut self.in_provider_call, true)
    }

    pub(crate) fn restore_provider_call(&mut self, prev: bool) {
        self.in_provider_call = prev;
    }

    /// C'è una chiamata a un provider in corso? Cioè: le tabelle dei provider
    /// sono in prestito, e quello che ci si legge dentro non è tutto.
    ///
    /// Lo chiede la disattivazione (§9.4), che da lì dentro si **rifiuta**
    /// invece di togliere zero provider e crederci.
    pub(crate) fn in_provider_call(&self) -> bool {
        self.in_provider_call
    }

    // --- drenaggio ---------------------------------------------------------

    /// Apre un drenaggio, se se ne può aprire uno. Rende `false` — e in quel
    /// caso non c'è niente da chiudere — quando il drenaggio va rimandato o è
    /// inutile.
    ///
    /// `has_handlers` arriva da fuori perché gli handler stanno nel registro
    /// dei provider, non qui: senza osservatori la coda va svuotata invece che
    /// accumulata all'infinito.
    pub(crate) fn begin_drain(&mut self, has_handlers: bool) -> bool {
        // La guardia di rientranza DEVE venire prima del fast-path qui sotto:
        // durante un dispatch gli handler sono estratti (`has_handlers` è
        // falso) e svuotare la coda qui butterebbe via gli eventi appena
        // accodati.
        //
        // `in_provider_call` è l'altra metà della stessa regola: un provider
        // che scrive durante `on_action`/`handle`/`flush` accoda, e la coda si
        // drena quando la SUA chiamata è tornata — mai dentro il suo frame
        // (a M5 il component model vieta la rientranza di un'istanza; la
        // semantica di consegna non può cambiare al freeze).
        if self.dispatching || self.in_provider_call || self.batch.is_some() {
            return false;
        }
        if !has_handlers {
            // Nessun osservatore: non accumulare eventi all'infinito.
            self.pending.clear();
            return false;
        }
        self.dispatching = true;
        true
    }

    /// Il prossimo evento da consegnare, o `None` quando il drenaggio è finito.
    ///
    /// È qui che vive il budget, ed è deliberato: il ciclo che sta sul
    /// `Workspace` consegna e basta: non conta, non decide quando fermarsi e
    /// non sa cosa sia un `Overflow`.
    pub(crate) fn next_to_deliver(&mut self, budget: &mut usize) -> Option<ToDeliver> {
        let notice = self.pending.pop_front()?;
        if *budget > 0 {
            *budget -= 1;
            return Some(ToDeliver::Notice(notice));
        }
        // L'evento estratto e i rimanenti non verranno consegnati.
        let dropped = (self.pending.len() + 1) as u64;
        self.pending.clear();
        // Il troncamento è del **kernel**: non lo ha chiesto chi stava
        // scrivendo, e attribuirglielo direbbe a un'automazione «questa l'hai
        // causata tu» proprio nel momento in cui le si chiede di riconciliare.
        let overflow = Notice::new(Event::Overflow { dropped }, Origin::by(Actor::Kernel));
        self.bus.emit(overflow.clone());
        Some(ToDeliver::Overflow(overflow))
    }

    /// Il budget iniziale di un drenaggio.
    pub(crate) fn budget() -> usize {
        DISPATCH_BUDGET
    }

    /// Scarta ciò che resta: usato dopo un `Overflow`, perché ciò che gli
    /// handler hanno emesso gestendolo non deve riaprire il ciclo.
    pub(crate) fn drop_pending(&mut self) {
        self.pending.clear();
    }

    pub(crate) fn end_drain(&mut self) {
        self.dispatching = false;
    }

    // --- job (lavoro lungo, fuori dal giro sincrono) -----------------------

    /// Accoda un job **di chi lo ha chiesto** e ne restituisce l'identità.
    ///
    /// Sta qui e non nell'host perché il contatore è del workspace: un host è
    /// un prestito per la durata di una chiamata, e un'identità che si conta
    /// dentro un prestito ricomincerebbe da capo a ogni prestito.
    pub(crate) fn enqueue_job(&mut self, plugin: &str, spec: JobSpec) -> JobId {
        let id = JobId(self.next_job_id);
        self.next_job_id += 1;
        self.pending_jobs.push(PendingJob {
            id,
            plugin: plugin.to_string(),
            spec,
        });
        id
    }

    pub(crate) fn take_pending_jobs(&mut self) -> Vec<PendingJob> {
        std::mem::take(&mut self.pending_jobs)
    }

    /// Toglie dalla coda i job di un plugin che sta smettendo (§9.4) e li
    /// restituisce, perché chi li toglie deve poterli **chiudere**: un job che
    /// sparisce senza un esito è un chiamante che aspetta per sempre.
    pub(crate) fn take_jobs_of(&mut self, plugin: &str) -> Vec<PendingJob> {
        let mut theirs = Vec::new();
        let mut rest = Vec::new();
        for job in std::mem::take(&mut self.pending_jobs) {
            if job.plugin == plugin {
                theirs.push(job);
            } else {
                rest.push(job);
            }
        }
        self.pending_jobs = rest;
        theirs
    }
}

/// Un job in coda: chi lo ha chiesto, con che identità, e cosa.
///
/// Il `plugin` non è decorazione ed è arrivato con la decisione 0028: il corpo
/// di un job è [`Plugin::run_job`](fubmd_abi::traits::Plugin::run_job), quindi
/// chi drena questa coda deve sapere **a quale plugin** chiederlo — e chi
/// disattiva un plugin deve sapere quali job non partiranno mai. Finché la coda
/// portava la sola coppia `(id, spec)` nessuna delle due domande aveva una
/// risposta nel kernel.
#[derive(Clone, Debug, PartialEq)]
pub struct PendingJob {
    pub id: JobId,
    /// L'id con cui chi lo ha chiesto si è dichiarato: è anche il plugin **con
    /// le cui capacità** il job girerà.
    pub plugin: String,
    pub spec: JobSpec,
}
