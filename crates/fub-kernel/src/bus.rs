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

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use fub_abi::{Actor, Event, Notice, Origin};

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

/// Il capo ricevente di un abbonamento, **col proprio conto degli arretrati**.
///
/// Non è un `Receiver<Notice>` nudo perché il conto va sottratto quando un
/// notice viene ritirato, e nessun `Receiver` lo farebbe da sé. Le tre porte
/// sono quelle di `std` e si comportano allo stesso modo: chi le usava prima non
/// cambia una riga.
pub struct Subscription {
    rx: Receiver<Notice>,
    queued: Arc<AtomicUsize>,
    dropped: Arc<AtomicU64>,
}

impl Subscription {
    pub fn recv(&self) -> Result<Notice, std::sync::mpsc::RecvError> {
        // Il debito si riscuote quando la coda è vuota, **prima** di mettersi ad
        // aspettare: chi ha finito di ritirare è esattamente chi può
        // riconciliare, e farlo aspettare un evento nuovo per dirglielo
        // vorrebbe dire non dirglielo affatto in un vault fermo.
        match self.rx.try_recv() {
            Ok(notice) => Ok(self.taken(notice)),
            Err(TryRecvError::Empty) => match self.debt() {
                Some(overflow) => Ok(overflow),
                None => self.rx.recv(),
            },
            Err(TryRecvError::Disconnected) => match self.debt() {
                Some(overflow) => Ok(overflow),
                None => self.rx.recv(),
            },
        }
    }

    pub fn try_recv(&self) -> Result<Notice, TryRecvError> {
        match self.rx.try_recv() {
            Ok(notice) => Ok(self.taken(notice)),
            Err(vuota) => self.debt().ok_or(vuota),
        }
    }

    pub fn recv_timeout(&self, timeout: Duration) -> Result<Notice, RecvTimeoutError> {
        match self.rx.try_recv() {
            Ok(notice) => Ok(self.taken(notice)),
            Err(TryRecvError::Empty) => match self.debt() {
                Some(overflow) => Ok(overflow),
                None => self.rx.recv_timeout(timeout),
            },
            Err(TryRecvError::Disconnected) => match self.debt() {
                Some(overflow) => Ok(overflow),
                None => Err(RecvTimeoutError::Disconnected),
            },
        }
    }

    /// Ciò che c'è adesso, senza aspettare. È la porta del ponte: un drenaggio a
    /// raffica, che finisce quando la coda è vuota.
    pub fn try_iter(&self) -> impl Iterator<Item = Notice> + '_ {
        std::iter::from_fn(|| self.try_recv().ok())
    }

    /// Il conto di ciò che il bus ha buttato mentre questo abbonato era
    /// indietro, riscosso **una volta sola**: lo `swap` è ciò che impedisce di
    /// dire due volte «riconcilia», qui e dal lato di chi emette.
    fn debt(&self) -> Option<Notice> {
        match self.dropped.swap(0, Ordering::Relaxed) {
            0 => None,
            dropped => Some(Notice::new(
                Event::Overflow { dropped },
                Origin::by(Actor::Kernel),
            )),
        }
    }

    fn taken(&self, notice: Notice) -> Notice {
        self.queued.fetch_sub(1, Ordering::Relaxed);
        notice
    }
}

/// Un abbonato visto dal bus: dove mandargli i notice, quanti ne ha in arretrato
/// e quanti gliene sono stati buttati da quando non glielo si dice.
struct Subscriber {
    tx: Sender<Notice>,
    queued: Arc<AtomicUsize>,
    /// Buttati e **non ancora dichiarati**, condiviso con la
    /// [`Subscription`]: lo riscuote chi arriva primo — chi emette, mettendo
    /// l'`Overflow` davanti al fatto nuovo, o chi ritira, trovando la coda
    /// vuota. Lo `swap` fa sì che a riscuoterlo sia **uno solo**: dirlo due
    /// volte sarebbe chiedere due riconciliazioni per una perdita sola.
    dropped: Arc<AtomicU64>,
}

impl Subscriber {
    /// Accoda, o butta e conta. Rende `false` se il capo ricevente è sparito —
    /// e allora il bus si dimentica di questo abbonato.
    fn deliver(&mut self, notice: &Notice) -> bool {
        if self.queued.load(Ordering::Relaxed) >= BACKLOG_CEILING && notice.event.is_recoverable() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return true;
        }
        // L'`Overflow` viene **prima** di ciò che lo ha sbloccato: chi legge
        // vede «hai perso N» e poi il fatto nuovo, che è l'ordine in cui le due
        // cose sono successe.
        match self.dropped.swap(0, Ordering::Relaxed) {
            0 => {}
            dropped => {
                // Il troncamento è del kernel, non di chi stava scrivendo: vale
                // la stessa attribuzione del budget del dispatch.
                let overflow = Notice::new(Event::Overflow { dropped }, Origin::by(Actor::Kernel));
                if !self.send(overflow) {
                    return false;
                }
            }
        }
        self.send(notice.clone())
    }

    fn send(&self, notice: Notice) -> bool {
        self.queued.fetch_add(1, Ordering::Relaxed);
        if self.tx.send(notice).is_ok() {
            true
        } else {
            self.queued.fetch_sub(1, Ordering::Relaxed);
            false
        }
    }
}

#[derive(Clone, Default)]
pub struct EventBus {
    subscribers: Arc<Mutex<Vec<Subscriber>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Crea un nuovo subscriber e restituisce il capo ricevente.
    pub fn subscribe(&self) -> Subscription {
        let (tx, rx) = channel();
        let queued = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicU64::new(0));
        self.subscribers.lock().unwrap().push(Subscriber {
            tx,
            queued: Arc::clone(&queued),
            dropped: Arc::clone(&dropped),
        });
        Subscription {
            rx,
            queued,
            dropped,
        }
    }

    /// Emette un evento a tutti i subscriber vivi; scarta quelli chiusi.
    pub fn emit(&self, notice: Notice) {
        let mut subs = self.subscribers.lock().unwrap();
        subs.retain_mut(|sub| sub.deliver(&notice));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::event::{Actor, BatchId, Origin};
    use fub_abi::model::DocId;
    use fub_abi::traits::JobId;
    use fub_abi::Event;

    fn cambiato(n: usize) -> Notice {
        Notice::of(Event::DocumentChanged {
            id: DocId::new(format!("nota-{n}.md")),
        })
    }

    #[test]
    fn delivers_to_subscribers_with_the_origin_attached() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        let notice = Notice::new(
            Event::DocumentChanged {
                id: DocId::new("a.md"),
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
        let mandati = BACKLOG_CEILING * 3;
        for n in 0..mandati {
            bus.emit(cambiato(n));
        }
        let arrivati: Vec<Notice> = rx.try_iter().collect();
        assert!(
            arrivati.len() <= BACKLOG_CEILING + 1,
            "il tetto non ha frenato: {} notice accodati su {mandati}",
            arrivati.len()
        );
        // E il troncamento non è silenzioso: chi non ritirava se lo sente dire,
        // col conto giusto.
        let persi: u64 = arrivati
            .iter()
            .filter_map(|n| match n.event {
                Event::Overflow { dropped } => Some(dropped),
                _ => None,
            })
            .sum();
        let consegnati = arrivati.len() as u64
            - arrivati
                .iter()
                .filter(|n| matches!(n.event, Event::Overflow { .. }))
                .count() as u64;
        assert_eq!(
            consegnati + persi,
            mandati as u64,
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
            bus.emit(cambiato(n));
        }
        // Sopra il tetto, e con la coda piena di roba recuperabile: l'esito di
        // un job lo aspetta chi lo ha chiesto, e nessuna riconciliazione lo
        // ritrova.
        bus.emit(Notice::of(Event::JobDone {
            id: JobId(7),
            job: "export".into(),
            result: Ok(serde_json::Value::Null),
        }));
        let arrivati: Vec<Notice> = rx.try_iter().collect();
        assert!(
            arrivati
                .iter()
                .any(|n| matches!(&n.event, Event::JobDone { id, .. } if *id == JobId(7))),
            "l'esito del job è stato buttato col resto: chi lo aspettava aspetta per sempre"
        );
    }

    #[test]
    fn taking_notices_makes_room_again() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        for n in 0..BACKLOG_CEILING {
            bus.emit(cambiato(n));
        }
        // Ritirati tutti, il conto torna a zero e il subscriber non è più in
        // debito: è la metà che un booleano «ha traboccato» non avrebbe.
        let primi: Vec<Notice> = rx.try_iter().collect();
        assert_eq!(primi.len(), BACKLOG_CEILING);
        bus.emit(cambiato(9999));
        let dopo: Vec<Notice> = rx.try_iter().collect();
        assert_eq!(dopo.len(), 1, "dopo aver ritirato, il tetto non frena più");
        assert!(!matches!(dopo[0].event, Event::Overflow { .. }));
    }
}
