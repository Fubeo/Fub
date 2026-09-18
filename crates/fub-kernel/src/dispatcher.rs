//! Il dispatcher: **la coda, il budget e l'origine** — cioè tutto ciò che
//! decide *quando* un evento parte, *con che nome* e *fino a quando* si
//! continua a consegnarne.
//!
//! È uno dei cinque componenti in cui il §8.1 scompone il `Workspace`, e mette
//! insieme tre cose che il piano nominava separate perché sono la stessa: il
//! lotto ([decisione 0011](../../../docs/decisions/README.md)) decide
//! *cosa esce*, l'origine
//! ([decisione 0012](../../../docs/decisions/0184-eventi-accodati-e-job.md))
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
//! # I posti da cui un evento sparisce
//!
//! Sono **quattro** [conta: code-che-si-svuotano], tutti in questo file, e
//! ognuno ha una ragione scritta accanto: il drenaggio senza osservatori
//! (`begin_drain`, dove non si perde niente perché sul bus quegli eventi sono
//! già passati), il travaso verso `salvaged` al troncamento (`next_to_deliver`,
//! che non butta niente — degrada), il tratto finale (`next_of_tail`, che conta
//! ciò che butta) e l'ultimissimo giro (`end_drain`, che è il prezzo della
//! terminazione). Quello che fino al §20.5 stava dentro `next_to_deliver` e
//! svuotava `pending` in blocco senza guardare [`Event::is_recoverable`] non
//! c'è più.
//!
//! Il conto è qui perché un quinto posto si aggiunge con una riga, e per due
//! giri ha contato **la sillaba invece della proprietà**: cercava
//! `self.pending.clear();` e non vedeva né il travaso che già c'era, né la
//! seconda coda (`salvaged`), né `truncate`, né un `clear()` con un commento in
//! coda. Adesso le due code sono di un tipo — [`EventQueue`] — che si svuota in
//! blocco da due sole porte, e il conto conta quelle.
//!
//! Per la stessa ragione le due guardie di stato — l'attore corrente e il flag
//! `in_provider_call` — qui sono coppie *scambia/ripristina*
//! (`Dispatcher::swap_actor`, `Dispatcher::enter_provider_call`) e non
//! funzioni che prendono una chiusura: la chiusura vorrebbe `&mut Workspace`,
//! che è esattamente ciò che questo componente non deve avere.

use std::collections::VecDeque;
use std::sync::Arc;

use fub_abi::model::DocId;
use fub_abi::rules::events::degrade;
use fub_abi::traits::{JobId, JobSpec};
use fub_abi::{Actor, BatchId, Event, Notice, Origin};

use crate::bus::EventBus;
use crate::poison::Condition;

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
    /// La stessa conoscenza, vista come insieme: la domanda «è già dentro?»
    /// si fa a ogni evento, e farla su un `Vec` è un giro del lotto per
    /// evento. Il `Vec` resta l'elenco che esce; questo è solo come ci si
    /// guarda dentro.
    touched: std::collections::HashSet<DocId>,
    /// Almeno un [`Event::IndexUpdated`] è stato soppresso: alla chiusura il
    /// lotto ha qualcosa da dire anche se non ha toccato documenti (una
    /// rimozione dal solo indice, un rebuild).
    index_dirty: bool,
}

/// A che punto è un drenaggio.
///
/// I tre stati esistono perché **il budget è un tetto sul lavoro, non sui
/// fatti**: quando finisce, ciò che si riscopre riguardando il vault si butta e
/// ciò che porta l'unica copia di un fatto si consegna lo stesso. Il tratto
/// finale è quindi una fase a sé — si consegna, ma non si accetta più niente di
/// nuovo — e senza uno stato esplicito sarebbe una condizione dedotta dalla
/// coda vuota, cioè indistinguibile dal drenaggio normale.
enum Drain {
    /// Si serve la coda, e ogni consegna costa un'unità di budget.
    Open,
    /// Il budget è finito: si serve ciò che il troncamento ha **salvato**, e
    /// ciò che gli handler emettono da qui in poi si conta invece di
    /// consegnarlo.
    Truncated,
    /// L'ultimo `Overflow` è stato consegnato: da qui non esce più niente, o il
    /// drenaggio non terminerebbe.
    Closed,
}

/// Una coda di eventi in attesa, col `VecDeque` **privato apposta**.
///
/// La ragione è un difetto misurato: il conto che presidiava i posti da cui un
/// evento sparisce cercava la riga `self.pending.clear();`, cioè una
/// **sillaba**. `truncate`, `drain(..)`, un `= VecDeque::new()` o lo stesso
/// `clear()` con un commento in coda gli passavano accanto, e la coda si
/// svuotava lo stesso. Qui a svuotarla in blocco ci sono **due sole porte** —
/// [`EventQueue::take_all`], che travasa senza perdere niente, e
/// [`EventQueue::discard_all`], che rende *quanti* ne ha buttati perché chi
/// butta debba farci qualcosa — e nessun'altra forma compila. Il conto
/// `code-che-si-svuotano` conta le chiamate a quelle due: la proprietà, non la
/// sillaba.
///
/// Il tipo è privato al modulo, e questo è ciò che rende onesto un conto che
/// legge **un file solo**: una seconda coda in un altro file non potrebbe
/// nominarlo.
#[derive(Default)]
struct EventQueue(VecDeque<Notice>);

impl EventQueue {
    fn len(&self) -> usize {
        self.0.len()
    }

    fn push_back(&mut self, notice: Notice) {
        self.0.push_back(notice);
    }

    fn pop_front(&mut self) -> Option<Notice> {
        self.0.pop_front()
    }

    fn iter(&self) -> std::collections::vec_deque::Iter<'_, Notice> {
        self.0.iter()
    }

    /// Svuota la coda **travasandone** il contenuto: qui non sparisce niente,
    /// e chi chiama deve farne qualcosa perché il valore torna indietro.
    fn take_all(&mut self) -> VecDeque<Notice> {
        std::mem::take(&mut self.0)
    }

    /// Svuota la coda **buttando** ciò che c'era, e rende quanti erano.
    ///
    /// Il `#[must_use]` è la metà che vale: chi butta o conta ciò che ha
    /// buttato, o scrive `let _ =` — cioè dichiara di saperlo.
    #[must_use]
    fn discard_all(&mut self) -> usize {
        let count = self.0.len();
        self.0.clear();
        count
    }

    /// Riempie una coda **vuota**.
    ///
    /// Non è un `=` sul campo: un'assegnazione butta in silenzio ciò che c'era,
    /// ed è l'unico modo di svuotare una coda che questo tipo non può vietare.
    /// Qui la condizione si dichiara invece di darsi per scontata.
    fn fill(&mut self, notices: impl IntoIterator<Item = Notice>) {
        debug_assert!(
            self.0.is_empty(),
            "a queue is filled from empty: filling a full one would discard \
             what was there without going through discard_all",
        );
        self.0.extend(notices);
    }
}

pub struct Dispatcher {
    bus: EventBus,
    /// Eventi in attesa di dispatch verso gli handler, ognuno con l'origine
    /// che aveva **al momento dell'emissione** — non quella del drenaggio, che
    /// può avvenire sotto un altro attore.
    pending: EventQueue,
    /// Il tratto finale di un drenaggio troncato: ciò che il budget non poteva
    /// buttare, più l'`Overflow` al posto di ciò che ha buttato, nell'ordine in
    /// cui le cose sono successe. È **una fotografia** della coda al momento
    /// del troncamento: finita quella, il drenaggio finisce — ed è ciò che
    /// tiene il tratto finale limitato senza un secondo budget da indovinare.
    salvaged: EventQueue,
    /// Quanti eventi il tratto finale ha buttato senza consegnarli: è il conto
    /// dell'`Overflow` di congedo.
    tail_dropped: u64,
    /// A che punto è il drenaggio in corso.
    drain: Drain,
    /// Guardia anti-rientranza: un drenaggio non si annida mai.
    dispatching: bool,
    /// Siamo dentro una chiamata a un provider (view `on_action`, `handle`,
    /// `flush`, `activate`, `invoke`)? Finché è alzato, il dispatch è
    /// rimandato: gli eventi arrivano **dopo che la chiamata del provider è
    /// tornata**, mai dentro il suo frame. È la semantica che il component
    /// model impone a M5 (un'istanza non è rientrante: un plugin che è sia
    /// view sia handler trapperebbe), promossa a contratto già in nativo.
    in_provider_call: bool,
    /// Il composition root ha chiuso la mutazione ma deve ancora rilasciare
    /// `Custody<Workspace>` prima di consegnare gli eventi. A differenza di
    /// `in_provider_call`, questo flag non significa che una tabella di
    /// provider è in prestito e quindi non blocca mount/unmount.
    dispatch_deferred: bool,
    /// Job richiesti via `HostEvents::spawn_job`, in attesa che l'host li
    /// esegua fuori dal giro sincrono.
    pending_jobs: Vec<PendingJob>,
    /// Il campanello che avverte chi li esegue. Vedi [`JobBell`].
    bell: Arc<JobBell>,
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
            pending: EventQueue::default(),
            salvaged: EventQueue::default(),
            tail_dropped: 0,
            drain: Drain::Open,
            dispatching: false,
            in_provider_call: false,
            dispatch_deferred: false,
            pending_jobs: Vec::new(),
            bell: Arc::new(JobBell::default()),
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
        // coalizza — vedi il doc di `fub_abi::event`.
        if let Some(state) = self.batch.as_mut() {
            if matches!(event, Event::IndexUpdated) {
                state.index_dirty = true;
                return;
            }
            if let Some(doc) = event.touched() {
                if state.touched.insert(doc.clone()) {
                    state.changed.push(doc.clone());
                }
            }
        }
        let notice = Notice::new(event, self.origin());
        self.bus.emit(notice.clone());
        self.pending.push_back(notice);
    }

    /// L'origine di ciò che il workspace sta emettendo adesso.
    ///
    /// La legge anche il registro delle mutazioni (§15.2), e di proposito la
    /// **stessa**: una riga di registro attribuita a un attore diverso da quello
    /// dell'evento che la accompagna sarebbe due risposte alla stessa domanda.
    pub(crate) fn origin(&self) -> Origin {
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
            touched: std::collections::HashSet::new(),
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

    /// Rimanda il drenaggio senza dichiarare in prestito alcuna tabella di
    /// provider. Rende il valore precedente per supportare frame annidati.
    pub(crate) fn defer_dispatch(&mut self) -> bool {
        std::mem::replace(&mut self.dispatch_deferred, true)
    }

    pub(crate) fn restore_dispatch(&mut self, previous: bool) {
        self.dispatch_deferred = previous;
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
        if self.dispatching
            || self.in_provider_call
            || self.dispatch_deferred
            || self.batch.is_some()
        {
            return false;
        }
        if !has_handlers {
            // Nessun osservatore: non accumulare eventi all'infinito. Qui non
            // si perde niente e non c'è niente da classificare — questa coda
            // serve i soli handler, e sul bus quegli eventi sono già passati
            // interi al momento dell'emissione.
            let _ = self.pending.discard_all();
            return false;
        }
        self.dispatching = true;
        self.drain = Drain::Open;
        self.tail_dropped = 0;
        true
    }

    /// Il prossimo evento da consegnare, o `None` quando il drenaggio è finito.
    ///
    /// È qui che vive il budget, ed è deliberato: il ciclo che sta sul
    /// `Workspace` consegna e basta — non conta, non decide quando fermarsi e
    /// non sa cosa sia un `Overflow`.
    ///
    /// # Cosa succede quando il budget finisce
    ///
    /// **Non si svuota la coda.** Il budget esiste per fermare una cascata di
    /// handler che si rimbalzano eventi, cioè per mettere un tetto al
    /// *lavoro*; buttare con essa anche i fatti che la cascata non ha causato è
    /// un'altra cosa, e per un evento non recuperabile è una perdita che
    /// nessuna riconciliazione ripara (§20.5). Quindi la coda si **degrada**
    /// con la regola del contratto ([`degrade`]), la stessa che applica il
    /// ponte verso la shell: ciò che si riscopre riguardando il vault diventa
    /// un `Overflow`, e ciò che porta l'unica copia di un fatto — un
    /// `trouble`, l'esito di un job, un custom — si consegna lo stesso.
    pub(crate) fn next_to_deliver(&mut self, budget: &mut usize) -> Option<Notice> {
        match self.drain {
            Drain::Open => {
                let notice = self.pending.pop_front()?;
                if *budget > 0 {
                    *budget -= 1;
                    return Some(notice);
                }
                let mut burst = Vec::with_capacity(self.pending.len() + 1);
                burst.push(notice);
                burst.extend(self.pending.take_all());
                self.salvaged.fill(degrade(burst));
                // L'`Overflow` che la regola ha messo al posto dei buttati
                // nasce **qui**, quindi va anche sul bus: i salvati ci sono già
                // passati al momento dell'emissione, e rimetterceli sarebbe
                // raccontare due volte lo stesso fatto a chi guarda.
                //
                // Il troncamento è del **kernel**: non lo ha chiesto chi stava
                // scrivendo, e attribuirglielo direbbe a un'automazione
                // «questa l'hai causata tu» proprio nel momento in cui le si
                // chiede di riconciliare — l'origine gliela dà `degrade`.
                for notice in self.salvaged.iter() {
                    if matches!(notice.event, Event::Overflow { .. }) {
                        self.bus.emit(notice.clone());
                    }
                }
                self.drain = Drain::Truncated;
                self.next_of_tail()
            }
            Drain::Truncated => self.next_of_tail(),
            Drain::Closed => None,
        }
    }

    /// Il tratto finale: si consegna la fotografia, e ciò che gli handler
    /// emettono mentre la ricevono **si conta**.
    ///
    /// Contarlo è la differenza fra questa e la versione di prima, che lo
    /// buttava in silenzio: la coda deve terminare — un handler che risponde a
    /// ogni evento con un evento non si ferma da sé — ma «non si può
    /// consegnare» e «non si può dire» sono due cose diverse, e la seconda era
    /// il difetto di questa voce un passo più in là.
    fn next_of_tail(&mut self) -> Option<Notice> {
        self.tail_dropped += self.pending.discard_all() as u64;
        if let Some(notice) = self.salvaged.pop_front() {
            return Some(notice);
        }
        self.drain = Drain::Closed;
        let dropped = std::mem::take(&mut self.tail_dropped);
        if dropped == 0 {
            return None;
        }
        let overflow = Notice::new(Event::Overflow { dropped }, Origin::by(Actor::Kernel));
        self.bus.emit(overflow.clone());
        Some(overflow)
    }

    /// Il budget iniziale di un drenaggio.
    pub(crate) fn budget() -> usize {
        DISPATCH_BUDGET
    }

    pub(crate) fn end_drain(&mut self) {
        self.dispatching = false;
        if matches!(self.drain, Drain::Closed) {
            // L'ultimissimo giro non si può raccontare: ciò che un handler
            // emette **ricevendo** l'`Overflow` di congedo si scarta senza
            // dirlo, perché dirlo vorrebbe dire un altro evento, che ne
            // produrrebbe altri. Il conto si ferma dove si è potuto dire.
            let _ = self.pending.discard_all();
        }
        self.drain = Drain::Open;
    }

    // --- job (lavoro lungo, fuori dal giro sincrono) -----------------------

    /// Accoda un job **di chi lo ha chiesto** e ne restituisce l'identità.
    ///
    /// Sta qui e non nell'host perché il contatore è del workspace: un host è
    /// un prestito per la durata di una chiamata, e un'identità che si conta
    /// dentro un prestito ricomincerebbe da capo a ogni prestito.
    /// Un'identità di job **senza una coda**: per il lavoro che il kernel fa da
    /// sé (l'indicizzazione dell'apertura, §15.7) e che quindi non ha un corpo
    /// da cercare nel registry.
    ///
    /// Il contatore è lo stesso, e deve esserlo: un id lo si annulla dal
    /// pulsante del centro attività senza sapere chi lo esegue, e due contatori
    /// vorrebbero dire due job vivi con lo stesso numero.
    pub(crate) fn next_job_id(&mut self) -> JobId {
        let id = JobId(self.next_job_id);
        self.next_job_id += 1;
        id
    }

    pub(crate) fn enqueue_job(&mut self, plugin: &str, spec: JobSpec) -> JobId {
        let id = JobId(self.next_job_id);
        self.next_job_id += 1;
        self.pending_jobs.push(PendingJob {
            id,
            plugin: plugin.to_string(),
            spec,
        });
        // Il campanello si suona **dopo** che il job è in coda, o chi si sveglia
        // troverebbe la coda vuota e tornerebbe a dormire su un lavoro che c'è.
        self.bell.ring();
        id
    }

    /// Il campanello dei job, da dare a chi possiede i thread.
    pub(crate) fn bell(&self) -> Arc<JobBell> {
        Arc::clone(&self.bell)
    }

    pub(crate) fn take_pending_jobs(&mut self) -> Vec<PendingJob> {
        std::mem::take(&mut self.pending_jobs)
    }

    /// Il primo id che non è ancora di nessuno: sotto è emesso, da qui in su no.
    pub(crate) fn jobs_issued(&self) -> u64 {
        self.next_job_id
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
/// di un job è [`Plugin::run_job`](fub_abi::traits::Plugin::run_job), quindi
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

/// **Il campanello dei job**: quanti ne sono stati accodati, e chi sta
/// aspettando che ne arrivi uno.
///
/// Il kernel è sincrono e non possiede thread — ma sa che *qualcuno* potrebbe
/// starne aspettando uno, e questo è tutto ciò che gli serve sapere. È la stessa
/// mossa della bandiera del rilevamento
/// ([decisione 0030](../../../docs/decisions/0183-composizione-host-kernel.md)):
/// il kernel possiede un pezzetto di stato condiviso e lo **presta** a chi fa il
/// mestiere che lui non fa. L'alternativa era un runner che interroga la coda a
/// intervalli, cioè una politica (ogni quanto? a che costo di batteria?) al
/// posto di un fatto.
///
/// # Il conto, e perché non è un booleano
///
/// `queued` è **quanti job sono stati accodati da sempre**, non «ce n'è uno».
/// Chi drena legge il conto *prima* di drenare e poi aspetta che cambi: così un
/// job accodato nella finestra fra il drenaggio e l'attesa non si perde — il
/// conto è già diverso, e l'attesa torna subito. Con un booleano quella
/// finestra sarebbe un job fermo fino al successivo, che è il genere di bug che
/// si vede una volta al mese e non si riproduce mai.
///
/// # E se il campanello si avvelena
///
/// Il conto sta in una [`Condizione`], non in un `Mutex` nudo, e la ragione è la
/// riga che la [0126](../../../docs/decisions/0184-eventi-accodati-e-job.md)
/// aveva lasciato scoperta: qui c'erano **sei** `.expect("campanello
/// avvelenato")`, e una frase ripetuta sei volte sembra una decisione presa
/// senza esserlo. La decisione c'era, ed è quella della 0126 — *cosa il
/// lucchetto protegge* è un `u64` monotòno, cioè niente che un panico a metà
/// renda incredibile, e `ring` non risponde a nessuno — ma stava in un
/// `expect`, dove non tiene: il settimo `expect` non l'avrebbe ereditata.
/// Adesso sta in un tipo, e il settimo non si può scrivere.
///
/// Un campanello ripreso costa **al più una suonata**, e non un job: chi
/// aspetta riguarda `queued`, che è monotòno e non torna indietro, quindi un
/// risveglio perso è un risveglio, non un lavoro. Il fatto resta osservabile da
/// [`Condizione::denunce`].
#[derive(Default)]
pub struct JobBell {
    queued: Condition<u64>,
}

impl JobBell {
    /// Suona: un job è entrato in coda (o qualcuno vuole svegliare chi aspetta).
    ///
    /// Sveglia **tutti** e non uno: un drenaggio prende tutti i job in coda, e
    /// chi si sveglia potrebbe non trovarne più (un altro thread lo ha
    /// preceduto). La regola sta in [`Condizione::cambia`], che è il posto in
    /// cui vale per chiunque.
    pub fn ring(&self) {
        self.queued.change(|queued| *queued += 1);
    }

    /// Quante volte ha suonato finora. Si legge **prima** di drenare.
    pub fn ticket(&self) -> u64 {
        *self.queued.acquire()
    }

    /// Quante volte il campanello si è ripreso da un avvelenamento. È l'unica
    /// traccia che ne resta, ed è dichiarata: vedi la testa del tipo.
    pub fn reports(&self) -> u32 {
        self.queued.reports()
    }

    /// Aspetta che suoni oltre `seen`, **o che scada `within`**, e restituisce
    /// il conto (che può essere ancora `seen`, se è scaduto il tempo).
    ///
    /// Esiste per le sveglie del §22.1 (decisione 0069) e non per il polling:
    /// chi drena continua a non chiedere «ce n'è uno?» a intervalli: chiede «mi
    /// svegli tu, ma non oltre questo momento, perché a quel punto ho un lavoro
    /// mio». La differenza è che l'intervallo non lo sceglie chi aspetta — lo
    /// dice la sveglia più vicina.
    pub fn wait_beyond_or(&self, seen: u64, within: std::time::Duration) -> u64 {
        let queued = self.queued.acquire();
        *self.queued.wait_or(queued, within, |q| *q == seen)
    }

    /// Aspetta che suoni oltre `seen`, e restituisce il conto nuovo.
    pub fn wait_beyond(&self, seen: u64) -> u64 {
        let queued = self.queued.acquire();
        *self.queued.wait(queued, |q| *q == seen)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deferring_delivery_does_not_mark_provider_tables_as_lent() {
        let mut dispatcher = Dispatcher::new(EventBus::new());

        let previous = dispatcher.defer_dispatch();
        assert!(
            !dispatcher.in_provider_call(),
            "delivery deferral must not block provider retirement"
        );
        assert!(
            !dispatcher.begin_drain(true),
            "delivery remains deferred until the composition root releases its guard"
        );

        dispatcher.restore_dispatch(previous);
        assert!(dispatcher.begin_drain(true));
        dispatcher.end_drain();
    }

    /// Avvelena un lucchetto facendo paniare **dentro** un `catch_unwind` col
    /// prestito in mano: è come lo produce la vita, e non serve un thread —
    /// quindi non c'è niente che possa andare in blocco invece che in rosso.
    ///
    /// L'hook dei panici si mette a tacere per la durata del misfatto, o un
    /// panico voluto stamperebbe la sua traccia e farebbe sembrare rotto un
    fn poison_bus(f: impl FnOnce()) {
        let old = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        std::panic::set_hook(old);
    }

    /// banco verde.
    /// **Un campanello avvelenato suona lo stesso, e chi aspetta si sveglia.**
    ///
    /// Coi sei `.expect("campanello avvelenato")` di prima questo caso non
    /// falliva un `assert`: paniava — nel thread del banco alla prima riga, e
    /// nell'app dentro il runner dei job, cioè nel thread che poi non accoda
    #[test]
    fn a_poisoned_bell_still_rings_and_wakes_waiters() {
        let bell = Arc::new(JobBell::default());
        poison_bus(|| {
            let _guard = bell.queued.acquire();
            panic!("someone dies holding the bell");
        });

        // più niente.
        // Il conto è monotòno e non è tornato indietro: ciò che il veleno può
        let ticket = bell.ticket();
        let waiter = {
            let bell = Arc::clone(&bell);
            std::thread::spawn(move || bell.wait_beyond(ticket))
        };
        bell.ring();
        assert_eq!(
            waiter.join().expect("the waiter reached the end"),
            ticket + 1
        );
        assert_eq!(
            bell.reports(),
            1,
            "one incident counts once, not once per call"
        );
    }

    // costare è un risveglio, non un job.
    /// L'attesa a scadenza è la seconda porta, e si rompe per conto suo: il
    #[test]
    fn a_poisoned_bell_times_out_anyway() {
        let bell = JobBell::default();
        poison_bus(|| {
            let _guard = bell.queued.acquire();
            panic!("boom");
        });
        let ticket = bell.ticket();
        assert_eq!(
            bell.wait_beyond_or(ticket, std::time::Duration::from_millis(1)),
            ticket,
            "when time runs out you return with the count that was there"
        );
        assert_eq!(bell.reports(), 1);
    }
}
