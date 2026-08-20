//! Event bus del kernel: pub/sub verso chi sta **fuori** dal giro sincrono.
//!
//! È un handle clonabile (Arc interno) così che thread esterni — es. il file
//! watcher nell'app — possano emettere eventi. Il frontend riceve gli eventi
//! via il ponte, che fa da subscriber.
//!
//! Ciò che viaggia è un [`Notice`] — l'evento **e la sua origine** (decisione 0012) — la
//! stessa cosa che ricevono gli `EventHandler`: due canali che portassero forme
//! diverse dello stesso fatto sarebbero due verità da tenere allineate a mano.
//!
//! # Il tetto (§10.2, decisione 0034): chi non ritira non fa crescere la memoria
//!
//! I canali sono **illimitati**, e devono restarlo: il kernel emette mentre
//! tiene il prestito esclusivo del workspace, e un `sync_channel` lo farebbe
//! aspettare un subscriber — cioè farebbe fermare l'app perché il webview è
//! occupato. Il freno quindi non sta sul mittente ma sul **conto degli
//! arretrati**: ogni subscriber sa quanti notice gli sono stati accodati e non
//! ancora ritirati, e sopra [`BACKLOG_CEILING`] il bus smette di accodargli ciò
//! che si **riscopre riguardando il vault**
//! ([`Event::is_recoverable`](fub_abi::Event::is_recoverable)).
//!
//! Il degrado non è silenzioso, ed è la sola forma che può avere: al posto di
//! ciò che è stato buttato arriva un [`Event::Overflow`] col conto, che è già
//! ciò che gli handler ricevono quando il budget del dispatch si esaurisce
//! (`dispatcher.rs`) e che la shell già sa leggere — «riconcilia da zero».
//!
//! Ciò che recuperabile non è passa **comunque**, anche sopra il tetto: l'esito
//! di un job lo sta aspettando chi lo ha chiesto, e nessuna riconciliazione lo
//! ritrova. Ne segue il limite, dichiarato: un subscriber che non ritira mai fa
//! crescere la memoria quanto il traffico non recuperabile che gli arriva. È un
//! traffico raro e di chi lo emette; il caso che questo tetto esiste per
//! chiudere — la scansione di un vault grande, o una sincronizzazione che tocca
//! mille note — è tutto dall'altra parte.
//!
//! # Il veleno (decisione 0126): un bus che tace non lo scopre nessuno
//!
//! L'elenco degli abbonati sta dietro un lucchetto, e un panico avvenuto mentre
//! qualcuno lo teneva lo avvelena. La politica dell'host — irrecuperabile, e da
//! lì in poi `Internal` a ogni chiamata ([decisione 0120]) — **qui non si può
//! applicare**: [`EventBus::emit`] non rende niente a nessuno, quindi «rispondi
//! di no» diventerebbe «taci per sempre», cioè una shell ferma su uno stato
//! vecchio senza una riga che dica perché.
//!
//! La differenza non è di comodo, ed è la regola della 0120 applicata bene: la
//! politica segue **cosa il lucchetto protegge**. Qui protegge un elenco di
//! destinatari indipendenti, non uno stato mutato a metà: `retain` lascia il
//! `Vec` valido anche se una consegna muore in mezzo, e ciò che si può essere
//! perso è **una consegna**, che in questo file ha già il suo vocabolario. Il
//! bus quindi si riprende, lo scrive una volta nel log, e mette in debito
//! **tutti** gli abbonati di un notice — così ognuno riceve un
//! [`Event::Overflow`] e riconcilia. Chi l'aveva ricevuto riconcilia per
//! niente: è il verso giusto in cui sbagliare.
//!
//! [decisione 0120]: ../../../docs/decisions/0120-un-lucchetto-avvelenato-si-dice-una-volta.md

use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::time::Duration;

use fub_abi::Notice;

/// Quanti notice possono restare non ritirati da un subscriber prima che il bus
/// cominci a buttare ciò che si riscopre riguardando il vault.
///
/// È lo stesso ordine di grandezza del `DISPATCH_BUDGET` degli handler, e per la
/// stessa ragione: sotto ci sta comodamente l'operazione più grossa che si fa
/// per intero (una rinomina con qualche centinaio di backlink), sopra c'è solo
/// una coda che nessuno sta più leggendo. Un numero più grande non comprerebbe
/// nulla — chi è indietro di mille eventi ha bisogno di riconciliare, non di
/// rincorrere.
const BACKLOG_CEILING: usize = 1024;

/// Il modulo esiste per una ragione sola: **i conti di un abbonamento sono del
/// canale**, e il canale è tutto qui dentro — tutti e due i capi, tutte e due
/// le metà di ogni conto.
mod intake {
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::Arc;

    use fub_abi::{Actor, Event, Notice, Origin};

    /// I due capi di un abbonamento e i due conti che ci stanno in mezzo: chi
    /// li vuole passa da qui, perché fuori non si possono costruire.
    pub(super) fn subscribe_internal() -> (Outbox, Intake) {
        let (tx, rx) = channel();
        let queued = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicU64::new(0));
        (
            Outbox {
                tx,
                queued: Arc::clone(&queued),
                dropped: Arc::clone(&dropped),
            },
            Intake {
                rx,
                queued,
                dropped,
            },
        )
    }

    /// Il capo da cui il bus **mette dentro**, col `Sender` privato apposta.
    ///
    /// La ragione è la gemella di quella di [`Intake`], scoperta dopo: la
    /// sottrazione stava dentro la porta e l'**aggiunta** era rimasta fuori,
    /// nel mittente, dove un secondo modo di accodare l'avrebbe potuta
    /// dimenticare esattamente come i due rami di ritiro avevano dimenticato la
    /// sottrazione. Un conto con due padroni non è un conto: qui il `Sender`
    /// fuori da questo modulo non si può nominare, quindi un notice non può
    /// entrare nel canale se non da [`Outbox::put`].
    pub(super) struct Outbox {
        tx: Sender<Notice>,
        queued: Arc<AtomicUsize>,
        /// Buttati e **non ancora dichiarati**, condiviso con l'[`Intake`]: lo
        /// riscuote chi arriva primo — chi emette, mettendo l'`Overflow` davanti
        /// al fatto nuovo, o chi ritira, trovando la coda vuota. Lo `swap` fa sì
        /// che a riscuoterlo sia **uno solo**: dirlo due volte sarebbe chiedere
        /// due riconciliazioni per una perdita sola.
        dropped: Arc<AtomicU64>,
    }

    impl Outbox {
        /// L'**unico** posto in cui un notice entra nel canale.
        ///
        /// Rende `false` se il capo ricevente è sparito — e allora ciò che era
        /// stato aggiunto al conto se lo riprende qui, non altrove: chi non è
        /// mai entrato non è un arretrato.
        pub(super) fn put(&self, notice: Notice) -> bool {
            self.queued.fetch_add(1, Ordering::Relaxed);
            if self.tx.send(notice).is_ok() {
                true
            } else {
                self.queued.fetch_sub(1, Ordering::Relaxed);
                false
            }
        }

        /// Quanti notice risultano accodati e non ancora ritirati: è la
        /// grandezza che il tetto legge.
        pub(super) fn queued(&self) -> usize {
            self.queued.load(Ordering::Relaxed)
        }

        /// Uno buttato perché l'abbonato è oltre il tetto.
        pub(super) fn dropped(&self) {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }

        pub(super) fn debt(&self) -> Option<Notice> {
            debt(&self.dropped)
        }
    }

    /// Il canale di un abbonamento **con il conto attaccato**, e col `Receiver`
    /// privato apposta.
    ///
    /// La ragione è un difetto misurato: il conto degli arretrati si sottraeva
    /// in una funzione che i **tre** rami di ritiro dovevano ricordarsi di
    /// chiamare, e due di loro — l'attesa bloccante di `recv` e quella di
    /// `recv_timeout` — non la chiamavano. La finestra era stretta (ci si arriva
    /// solo quando la coda è vuota al primo tentativo e chi emette la riempie
    /// subito dopo), ma il conto sbagliato non si ripara più: cresce a ogni
    /// passaggio, e arrivato al tetto degli arretrati il bus comincia a buttare
    /// gli eventi recuperabili di un abbonato che non è indietro di niente.
    ///
    /// Qui il ramo dimenticabile non esiste: fuori da questo modulo il
    /// `Receiver` non si può nominare, quindi un notice non può uscire dal
    /// canale se non da [`Intake::take`], che sottrae **per costruzione**. Chi
    /// aggiunge un modo di aspettare sceglie *quanto* attendere — è ciò che
    /// passa nella chiusura — non *se* scalare l'arretrato; e se prova a
    /// scavalcare la porta non compila.
    pub(super) struct Intake {
        rx: Receiver<Notice>,
        queued: Arc<AtomicUsize>,
        dropped: Arc<AtomicU64>,
    }

    impl Intake {
        /// L'**unico** posto in cui un notice esce dal canale.
        ///
        /// `wait_for` dice come aspettarlo — subito, per sempre, o fino a un
        /// tempo —: qualunque sia, ciò che esce è già stato sottratto dal conto.
        pub(super) fn take<E>(
            &self,
            wait_for: impl FnOnce(&Receiver<Notice>) -> Result<Notice, E>,
        ) -> Result<Notice, E> {
            let notice = wait_for(&self.rx)?;
            self.queued.fetch_sub(1, Ordering::Relaxed);
            Ok(notice)
        }

        pub(super) fn debt(&self) -> Option<Notice> {
            debt(&self.dropped)
        }

        /// **Estingue** il debito invece di riscuoterlo, e rende quanto valeva.
        ///
        /// È la stessa mossa di [`debito`] — lo `swap` che impedisce di dirlo
        /// due volte — con l'altra risposta: si usa quando il bus non c'è più,
        /// e serve che stia qui dentro perché la sottrazione di questo conto è
        /// del modulo che lo possiede, non di chi ritira.
        pub(super) fn settle(&self) -> u64 {
            self.dropped.swap(0, Ordering::Relaxed)
        }

        /// Quanti notice risultano accodati e non ancora ritirati: è la
        /// grandezza che il tetto legge, e i banchi la guardano da qui.
        #[cfg(test)]
        pub(super) fn queued(&self) -> usize {
            self.queued.load(Ordering::Relaxed)
        }
    }

    /// Il conto di ciò che il bus ha buttato mentre questo abbonato era
    /// indietro, riscosso **una volta sola**: lo `swap` è ciò che impedisce di
    /// dire due volte «riconcilia», dal lato di chi ritira e da quello di chi
    /// emette. Che la frase sia una sola funzione e non due copie è la stessa
    /// ragione: due `Overflow` costruiti in due posti sono due verità da tenere
    /// allineate a mano.
    fn debt(dropped: &AtomicU64) -> Option<Notice> {
        match dropped.swap(0, Ordering::Relaxed) {
            0 => None,
            dropped => Some(Notice::new(
                Event::Overflow { dropped },
                Origin::by(Actor::Kernel),
            )),
        }
    }
}

use intake::{Intake, Outbox};

/// Il capo ricevente di un abbonamento, **col proprio conto degli arretrati**.
///
/// Non è un `Receiver<Notice>` nudo perché il conto va sottratto quando un
/// notice viene ritirato, e nessun `Receiver` lo farebbe da sé. Le tre porte
/// sono quelle di `std` e si comportano allo stesso modo: chi le usava prima non
/// cambia una riga.
pub struct Subscription {
    intake: Intake,
}

impl Subscription {
    pub fn recv(&self) -> Result<Notice, std::sync::mpsc::RecvError> {
        // Il debito si riscuote quando la coda è vuota, **prima** di mettersi ad
        // aspettare: chi ha finito di ritirare è esattamente chi può
        // riconciliare, e farlo aspettare un evento nuovo per dirglielo
        // vorrebbe dire non dirglielo affatto in un vault fermo.
        match self.intake.take(Receiver::try_recv) {
            Ok(notice) => Ok(notice),
            Err(TryRecvError::Empty) => match self.debt() {
                Some(overflow) => Ok(overflow),
                None => self.intake.take(Receiver::recv),
            },
            // Il bus non c'è più, e il debito **si estingue invece di essere
            // riscosso**: vedi `close_account`.
            Err(TryRecvError::Disconnected) => {
                self.close_account();
                self.intake.take(Receiver::recv)
            }
        }
    }

    pub fn try_recv(&self) -> Result<Notice, TryRecvError> {
        match self.intake.take(Receiver::try_recv) {
            Ok(notice) => Ok(notice),
            Err(TryRecvError::Empty) => self.debt().ok_or(TryRecvError::Empty),
            Err(TryRecvError::Disconnected) => {
                self.close_account();
                Err(TryRecvError::Disconnected)
            }
        }
    }

    pub fn recv_timeout(&self, timeout: Duration) -> Result<Notice, RecvTimeoutError> {
        match self.intake.take(Receiver::try_recv) {
            Ok(notice) => Ok(notice),
            Err(TryRecvError::Empty) => match self.debt() {
                Some(overflow) => Ok(overflow),
                None => self.intake.take(|rx| rx.recv_timeout(timeout)),
            },
            Err(TryRecvError::Disconnected) => {
                self.close_account();
                Err(RecvTimeoutError::Disconnected)
            }
        }
    }

    /// Ciò che c'è adesso, senza aspettare. È la porta del ponte: un drenaggio a
    /// raffica, che finisce quando la coda è vuota.
    pub fn try_iter(&self) -> impl Iterator<Item = Notice> + '_ {
        std::iter::from_fn(|| self.try_recv().ok())
    }

    /// Il conto di ciò che il bus ha buttato mentre questo abbonato era
    /// indietro, riscosso **una volta sola** dal canale che lo tiene.
    fn debt(&self) -> Option<Notice> {
        self.intake.debt()
    }

    /// **Il bus è sparito**: il debito si estingue invece di essere riscosso.
    ///
    /// Un `Overflow` non è una notizia, è una **richiesta**: dice «riconcilia da
    /// zero», e chi lo riceve la esegue — la shell ricarica l'albero, le view,
    /// il documento aperto. Ha senso finché c'è qualcosa da rileggere. Un canale
    /// disconnesso vuol dire che il bus è caduto, cioè che il vault si sta
    /// chiudendo: la riconciliazione partirebbe contro un vault che non c'è più,
    /// e ciò che ne torna sono errori a schermo sopra un'operazione — chiudere —
    /// che è riuscita. Chiedere di riconciliare a chi non riceverà mai la
    /// conferma non è dire la verità in ritardo: è dare un ordine impossibile.
    ///
    /// Il conto sparisce comunque, e questo è il posto in cui ciò che si è perso
    /// viene detto: un debito estinto è l'unico caso in cui nessuno recupererà
    /// quegli eventi, e il log è l'unico canale che resta quando il bus non c'è
    /// (stessa ragione della [0126] per la riga dell'avvelenamento).
    ///
    /// [0126]: ../../../docs/decisions/0126-un-bus-che-tace-non-lo-scopre-nessuno.md
    fn close_account(&self) {
        let dropped = self.intake.settle();
        if dropped > 0 {
            tracing::debug!(
                target: "fub.kernel",
                dropped,
                "il bus si è chiuso mentre un abbonato era indietro: nessuna \
                 riconciliazione, perché non c'è più niente da rileggere"
            );
        }
    }

    /// Quanti notice risultano accodati e non ancora ritirati.
    #[cfg(test)]
    fn queued(&self) -> usize {
        self.intake.queued()
    }

    /// Ritira passando dalla porta con un'attesa **fabbricata dal banco**: è il
    /// solo modo di costruire la finestra stretta invece di sperarla, cioè di
    /// far succedere l'emissione *dopo* che il ramo non bloccante ha trovato
    /// vuoto e *prima* che quello bloccante riceva.
    #[cfg(test)]
    fn take_waiting<E>(
        &self,
        wait_for: impl FnOnce(&Receiver<Notice>) -> Result<Notice, E>,
    ) -> Result<Notice, E> {
        self.intake.take(wait_for)
    }
}

/// Un abbonato visto dal bus: dove mandargli i notice, quanti ne ha in arretrato
/// e quanti gliene sono stati buttati da quando non glielo si dice.
struct Subscriber {
    out: Outbox,
}

impl Subscriber {
    /// Accoda, o butta e conta. Rende `false` se il capo ricevente è sparito —
    /// e allora il bus si dimentica di questo abbonato.
    /// Mettilo in debito di un notice senza avergliene buttato uno: è ciò che
    /// il bus fa a tutti quando si riprende da un veleno, perché una consegna
    /// interrotta a metà dell'elenco non dice quali metà.
    fn lost_one(&self) {
        self.out.dropped();
    }

    fn deliver(&self, notice: &Notice) -> bool {
        if self.out.queued() >= BACKLOG_CEILING && notice.event.is_recoverable() {
            self.out.dropped();
            return true;
        }
        // L'`Overflow` viene **prima** di ciò che lo ha sbloccato: chi legge
        // vede «hai perso N» e poi il fatto nuovo, che è l'ordine in cui le due
        // cose sono successe. Il troncamento è del kernel, non di chi stava
        // scrivendo: vale la stessa attribuzione del budget del dispatch.
        if let Some(overflow) = self.out.debt() {
            if !self.out.put(overflow) {
                return false;
            }
        }
        self.out.put(notice.clone())
    }
}

/// Il modulo esiste per una ragione sola: il lucchetto dell'elenco è privato
/// **qui dentro**, e con lui la risposta alla domanda «e se è avvelenato?».
mod roster {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

    use super::Subscriber;

    /// L'elenco degli abbonati, col suo lucchetto e la sua politica.
    ///
    /// `.lock()` su un `Roster` non esiste, quindi non compila: chi vuole
    /// l'elenco passa da [`Roster::with`], e la domanda «cosa si fa se è
    /// avvelenato?» ha una risposta sola, scritta una volta.
    #[derive(Clone, Default)]
    pub(super) struct Roster {
        subs: Arc<Mutex<Vec<Subscriber>>>,
        /// Quante volte questo bus si è ripreso da un veleno. È **del bus** e
        /// non del processo: due vault aperti sono due elenchi.
        reports: Arc<AtomicU32>,
    }

    impl Roster {
        /// L'**unico** posto in cui si tiene l'elenco.
        pub(super) fn with<T>(&self, f: impl FnOnce(&mut Vec<Subscriber>) -> T) -> T {
            let mut subs = match self.subs.lock() {
                Ok(subs) => subs,
                Err(poison) => self.recover(poison),
            };
            f(&mut subs)
        }

        /// La politica, in un posto solo: **riprenditi, dillo una volta, e
        /// paga il debito a tutti**.
        ///
        /// `into_inner` qui non è mentire — ed è la ragione per cui la risposta
        /// è l'opposta di quella dell'host. Ciò che il lucchetto protegge è un
        /// elenco di destinatari indipendenti: `Vec::retain` tiene il vettore
        /// valido anche se il predicato pania in mezzo, e nessun abbonato è
        /// mezzo-mutato dall'infortunio di un altro. Ciò che si può essere
        /// perso è **una consegna**, e per quella c'è già l'`Overflow`.
        ///
        /// `clear_poison` fa sì che «una volta» sia una volta *per
        /// avvelenamento* e non per sempre: un secondo panico è un secondo
        /// incidente, e merita la sua riga.
        #[cold]
        fn recover<'a>(
            &self,
            poison: PoisonError<MutexGuard<'a, Vec<Subscriber>>>,
        ) -> MutexGuard<'a, Vec<Subscriber>> {
            let subs = poison.into_inner();
            self.subs.clear_poison();
            self.reports.fetch_add(1, Ordering::Relaxed);
            tracing::error!(
                target: "fub.kernel",
                subscribers = subs.len(),
                "il bus degli eventi si è poison_busto: qualcuno è morto mentre teneva \
                 l'elenco degli abbonati. Nessun file sul disco è toccato; una consegna \
                 può essersi persa, e chi è abbonato riceve un Overflow per riconciliare."
            );
            for sub in subs.iter() {
                sub.lost_one();
            }
            subs
        }

        /// Quante volte questo bus si è ripreso.
        #[cfg(test)]
        pub(super) fn reports(&self) -> u32 {
            self.reports.load(Ordering::Relaxed)
        }
    }
}

use roster::Roster;

#[derive(Clone, Default)]
pub struct EventBus {
    subscribers: Roster,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Crea un nuovo subscriber e restituisce il capo ricevente.
    pub fn subscribe(&self) -> Subscription {
        let (out, intake) = intake::subscribe_internal();
        self.subscribers.with(|subs| subs.push(Subscriber { out }));
        Subscription { intake }
    }

    /// Emette un evento a tutti i subscriber vivi; scarta quelli chiusi.
    pub fn emit(&self, notice: Notice) {
        self.subscribers
            .with(|subs| subs.retain(|sub| sub.deliver(&notice)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    use fub_abi::event::{Actor, BatchId, Origin};
    use fub_abi::model::DocId;
    use fub_abi::traits::JobId;
    use fub_abi::Event;

    fn changed(n: usize) -> Notice {
        Notice::of(Event::DocumentChanged {
            id: DocId::new(format!("nota-{n}.md")),
            changes: None,
        })
    }

    #[test]
    fn delivers_to_subscribers_with_the_origin_attached() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        let notice = Notice::new(
            Event::DocumentChanged {
                id: DocId::new("a.md"),
                changes: None,
            },
            Origin::by(Actor::Watcher).in_batch(Some(BatchId(3))),
        );
        bus.emit(notice.clone());
        assert_eq!(rx.recv().unwrap(), notice);
    }

    #[test]
    fn a_subscriber_that_never_takes_stops_growing_and_is_told() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        let sent = BACKLOG_CEILING * 3;
        for n in 0..sent {
            bus.emit(changed(n));
        }
        let arrived: Vec<Notice> = rx.try_iter().collect();
        assert!(
            arrived.len() <= BACKLOG_CEILING + 1,
            "il tetto non ha frenato: {} notice accodati su {sent}",
            arrived.len()
        );
        // E il troncamento non è silenzioso: chi non ritirava se lo sente dire,
        // col conto giusto.
        let dropped: u64 = arrived
            .iter()
            .filter_map(|n| match n.event {
                Event::Overflow { dropped } => Some(dropped),
                _ => None,
            })
            .sum();
        let delivered = arrived.len() as u64
            - arrived
                .iter()
                .filter(|n| matches!(n.event, Event::Overflow { .. }))
                .count() as u64;
        assert_eq!(
            delivered + dropped,
            sent as u64,
            "il conto dei persi più quello dei consegnati deve fare il totale: \
             un evento che sparisce senza entrare in nessuno dei due conti è \
             esattamente ciò che questo tetto esiste per non fare"
        );
    }

    #[test]
    fn what_cannot_be_rediscovered_passes_the_ceiling() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        for n in 0..BACKLOG_CEILING * 2 {
            bus.emit(changed(n));
        }
        // Sopra il tetto, e con la coda piena di roba recuperabile: l'esito di
        // un job lo aspetta chi lo ha chiesto, e nessuna riconciliazione lo
        // ritrova.
        bus.emit(Notice::of(Event::JobDone {
            id: JobId(7),
            job: "export".into(),
            result: Ok(serde_json::Value::Null),
        }));
        let arrived: Vec<Notice> = rx.try_iter().collect();
        assert!(
            arrived
                .iter()
                .any(|n| matches!(&n.event, Event::JobDone { id, .. } if *id == JobId(7))),
            "l'esito del job è stato buttato col resto: chi lo aspettava aspetta per sempre"
        );
    }

    #[test]
    fn a_notice_that_arrives_while_waiting_is_subtracted_too() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        // La finestra si **costruisce**, non si spera: la coda è vuota (nessuno
        // ha ancora emesso), l'emissione avviene dentro l'attesa — cioè dopo
        // che il ramo non bloccante avrebbe trovato vuoto — e il notice esce
        // dal ramo che aspetta. È la sequenza esatta del difetto, senza
        // scheduler e senza tempi.
        let received = rx.take_waiting(|channel| {
            bus.emit(changed(1));
            channel.recv()
        });
        assert!(received.is_ok());
        assert_eq!(
            rx.queued(),
            0,
            "il notice è uscito dal canale senza essere sottratto dagli \
             arretrati: il conto non si ripara più, e a BACKLOG_CEILING passaggi \
             il bus butta i recuperabili di chi non è indietro di niente"
        );
    }

    #[test]
    fn the_count_survives_a_race_between_emitting_and_waiting() {
        // La stessa proprietà dalla porta pubblica, con chi emette che parte
        // solo quando chi ritira sta per mettersi ad aspettare: qui la finestra
        // non è garantita a ogni giro, ma ciò che si accumula quando capita
        // resta accumulato, e alla fine il conto o è zero o non lo è più.
        const GIRI: usize = 256;
        let bus = EventBus::new();
        let rx = bus.subscribe();
        let (pronto_tx, pronto_rx) = channel::<()>();
        let emettitore = std::thread::spawn(move || {
            for n in 0..GIRI {
                if pronto_rx.recv().is_err() {
                    return;
                }
                bus.emit(changed(n));
            }
        });
        for _ in 0..GIRI {
            pronto_tx.send(()).unwrap();
            rx.recv().unwrap();
        }
        emettitore.join().unwrap();
        assert_eq!(
            rx.queued(),
            0,
            "ritirati tutti i notice, l'arretrato deve essere zero"
        );
    }

    #[test]
    fn taking_notices_makes_room_again() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        for n in 0..BACKLOG_CEILING {
            bus.emit(changed(n));
        }
        // Ritirati tutti, il conto torna a zero e il subscriber non è più in
        // debito: è la metà che un booleano «ha traboccato» non avrebbe.
        let first: Vec<Notice> = rx.try_iter().collect();
        assert_eq!(first.len(), BACKLOG_CEILING);
        bus.emit(changed(9999));
        let after: Vec<Notice> = rx.try_iter().collect();
        assert_eq!(after.len(), 1, "dopo aver ritirato, il tetto non frena più");
        assert!(!matches!(after[0].event, Event::Overflow { .. }));
    }

    /// Il codice di produzione di questo file **meno** ciò che sta dentro le
    /// due porte, che è dove quelle parole devono stare.
    ///
    /// Una porta strutturale rende una forma inesprimibile, ma solo per chi ci
    /// passa: niente impedisce di riscrivere accanto un `Sender` e un contatore
    /// nudi, o un secondo `Mutex` con la sua politica improvvisata, e il
    /// compilatore direbbe di sì perché non c'è niente di illegale da dire. È la
    /// zona cieca già misurata sulla
    /// [0120](../../../docs/decisions/0120-un-lucchetto-avvelenato-si-dice-una-volta.md),
    /// dove quattordici siti erano rimasti col codice vecchio a crate verde.
    ///
    /// **Ciò che questo conto non vede, dichiarato**: i banchi, che sono
    /// tagliati via apposta (un canale di prova è roba loro, e ne usano uno per
    /// sincronizzare i thread); un lucchetto o un conto scritto in un *altro*
    /// file del kernel, che questo presidio non apre — la porta è di `bus.rs` e
    /// il conto guarda `bus.rs`; e un terzo modulo aggiunto qui dentro, che non
    /// verrebbe tagliato e quindi risulterebbe rosso: è il verso giusto in cui
    /// sbagliare, perché costringe a dichiararlo.
    fn outside_gates() -> String {
        let source = include_str!("bus.rs");
        let (production, _benches) = source
            .split_once("#[cfg(test)]\nmod tests {")
            .expect("the test cut: if it changes, this count looks at less, not more");
        let mut outside = production.to_string();
        for (opens, closes) in [
            ("mod intake {", "\nuse intake::"),
            ("mod roster {", "\nuse roster::"),
        ] {
            let (before, rest) = outside
                .split_once(opens)
                .unwrap_or_else(|| panic!("the gate `{opens}` is gone"));
            let (_inside, after) = rest
                .split_once(closes)
                .unwrap_or_else(|| panic!("`{opens}` ends where it is imported"));
            let combined = format!("{before}{after}");
            outside = combined;
        }
        outside
    }

    /// **Il conto che verifica che la porta dei conti abbia agganciato.**
    #[test]
    fn the_subscribe_internal_counts_are_not_touched_from_outside() {
        let outside = outside_gates();
        for forbidden in [
            "fetch_add",
            "fetch_sub",
            "AtomicUsize",
            "AtomicU64",
            "tx.send(",
        ] {
            assert!(
                !outside.contains(forbidden),
                "`{forbidden}` appears outside `mod intake`: half of a subscription
                 count has two owners again, and the forgotten one can no longer
                 be fixed — at BACKLOG_CEILING passes the bus drops recoverable
                 events from a subscriber that is not behind at all"
            );
        }
    }

    /// **Il conto che verifica che la porta del lucchetto abbia agganciato.**
    #[test]
    fn the_lock_of_the_list_not_is_takes_from_outside() {
        let outside = outside_gates();
        for forbidden in [
            "Mutex",
            ".lock()",
            "PoisonError",
            "clear_poison",
            "into_inner",
        ] {
            assert!(
                !outside.contains(forbidden),
                "`{forbidden}` compare fuori da `mod roster`: la domanda «e se è \
                 poison_busto?» ha di nuovo due posti dove rispondere, e il secondo \
                 non ha nessuno a cui rispondere — un bus che tace non lo scopre \
                 nessuno"
            );
        }
    }

    /// **A un bus chiuso non si chiede di riconciliare.**
    ///
    /// Il debito è vero — quegli eventi sono stati buttati davvero — ma
    /// l'`Overflow` con cui lo si dice non è un'informazione: è l'ordine
    /// «rileggi il vault da zero». Consegnarlo quando il bus è già caduto vuol
    /// dire mandare la shell a rileggere un vault che si sta chiudendo, e ciò
    /// che ne torna sono errori a schermo sopra una chiusura riuscita.
    #[test]
    fn a_bus_closed_not_asks_of_reconcile() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        // Uno sopra il tetto: il primo di troppo viene buttato e diventa debito.
        for n in 0..=BACKLOG_CEILING {
            bus.emit(changed(n));
        }
        drop(bus);

        let mut seen = Vec::new();
        while let Ok(notice) = rx.try_recv() {
            seen.push(notice);
        }
        assert!(
            !seen
                .iter()
                .any(|n| matches!(n.event, Event::Overflow { .. })),
            "l'ultimo messaggio di un bus caduto è «riconcilia», detto a chi non \
             riceverà mai la conferma: la shell rilegge un vault che non c'è più \
             e mostra i suoi errori sopra una chiusura riuscita"
        );
        assert_eq!(
            seen.len(),
            BACKLOG_CEILING,
            "ciò che era in coda si ritira lo stesso: il bus caduto non gate \
             via ciò che aveva già consegnato"
        );
        assert!(
            rx.recv().is_err(),
            "e dopo non c'è nient'altro: il canale è finito"
        );
    }

    /// La politica della 0126, dal comportamento: il veleno si produce come lo
    /// produce la vita — un panico mentre qualcuno tiene l'elenco.
    #[test]
    fn a_bus_poison_bust_continues_a_deliver_and_puts_all_in_debt() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        // L'hook dei panici tace per la durata del misfatto, o un panico voluto
        // stamperebbe la sua traccia e farebbe sembrare rotto un banco verde.
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let other = bus.clone();
        let dead = std::thread::spawn(move || other.subscribers.with(|_| panic!("a metà")));
        assert!(dead.join().is_err(), "il misfatto deve essere successo");
        std::panic::set_hook(hook);

        bus.emit(changed(1));
        let arrived: Vec<Notice> = rx.try_iter().collect();
        assert!(
            arrived
                .iter()
                .any(|n| matches!(n.event, Event::DocumentChanged { .. })),
            "il bus ha smesso di consegnare: la shell resta shutdown su uno stato \
             vecchio e nessuno dice perché"
        );
        assert!(
            arrived
                .iter()
                .any(|n| matches!(n.event, Event::Overflow { .. })),
            "l'abbonato non è stato messo in debt: una consegna può essersi \
             persa in mezzo all'elenco e lui non lo saprà mai"
        );
        assert_eq!(bus.subscribers.reports(), 1);
        bus.emit(changed(2));
        assert_eq!(
            bus.subscribers.reports(),
            1,
            "una denuncia per poison_busmento, non una per chiamata"
        );
    }
}
