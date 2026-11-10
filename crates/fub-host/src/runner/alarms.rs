//! Le sveglie dei componenti: `Alarms` e i suoi quadranti, fra tempo
//! monotono e tempo di parete.

use super::*;

/// Lo **scheduler delle sveglie** (§22.1, decisione 0069; §22.4, decisione
/// 0091): la metà che il contratto non guarda, e che sta qui perché il tempo è
/// di chi possiede i thread.
///
/// Il kernel dice **quali** sveglie sono dichiarate
/// ([`Workspace::declared_timers`]) e con che regola suonano
/// ([`TimerSchedule::nth_after`] per il tempo trascorso,
/// [`WallClock::next_after`] per l'ora civile); questa struttura tiene la sola
/// cosa che il kernel non può tenere senza leggere un orologio: dov'è arrivata.
///
/// # Due sorgenti di tempo, e perché non si mescolano
///
/// L'ancora di `every`/`after` è un [`Instant`] e non un orario di sistema, ed è
/// la ragione per cui «ogni ora» vuol dire un'ora anche se qualcuno sposta
/// l'orologio della macchina. Un orario di parete non si può misurare così — un
/// `Instant` non ha un calendario — e ne vuole una seconda, che è
/// [`crate::wall`].
///
/// Le due **non si sommano mai**: l'attesa resta sempre e solo monotona, perché
/// aspettare è «per quanto» e non «fino a quando». Il tempo di parete entra in
/// un punto solo — *fra quanti secondi accade quell'ora civile* — e da lì in poi
/// il campo [`next`](Quadrant::next) è dello stesso tipo per tutte e
/// tre le forme. Un orologio spostato allunga o accorcia una singola attesa e
/// poi si ricalcola; che una sveglia di parete non suoni due volte non dipende
/// dall'orologio ma dalla sua [`last`](Quadrant::last) occorrenza civile.
#[derive(Default)]
pub(super) struct Alarms {
    /// Chiave: (componente, nome della sveglia).
    pub(super) quadrants: HashMap<(String, String), Quadrant>,
    /// I recuperi di parete accumulati da [`wall`](Alarms::wall), da
    /// drenare una volta sola in [`expired`](Alarms::expired). Li accumula
    /// `wall` e non chi la chiama perché
    /// [`reconcile_with_cursors`](Alarms::reconcile_with_cursors)
    /// e [`expired`](Alarms::expired) la chiamano entrambe: se il risultato
    /// tornasse al chiamante, la riconciliazione lo butterebbe via e il
    /// recupero si perderebbe — [`position`](Quadrant::position) è già
    /// avanzato, e la chiamata dopo non lo rivede.
    pub(super) recoveries: Vec<(String, String)>,
}

pub(super) struct Quadrant {
    schedule: TimerSchedule,
    /// Da quando si conta: la prima volta che questo scheduler l'ha vista.
    /// Solo per il tempo trascorso — un orario di parete non conta da quando è
    /// stato registrato, conta dal calendario.
    pub(super) still: Instant,
    /// Quante volte ha già suonato (tempo trascorso).
    fired: u64,
    /// Dove sta una sveglia di **parete**: l'ultima occorrenza civile
    /// considerata e quella che sta aspettando.
    ///
    /// È l'invariante «al più una suonata per occorrenza» reso un campo, ed è
    /// ciò che fa suonare una volta sola le 2:30 che l'uscita dell'ora legale fa
    /// accadere due volte.
    pub(super) position: Position,
    /// Quando suona la prossima. `None` = ha finito (un `after` che è già
    /// suonato, o un orario di parete impossibile), e la voce **resta** in mappa
    /// proprio per non essere riseminata dalla riconciliazione al giro dopo.
    pub(super) next: Option<Instant>,
}

impl Alarms {
    pub(super) fn reconcile_with_cursors_at(
        &mut self,
        declared: &[(String, fub_abi::traits::TimerSpec)],
        now: Instant,
        machine_zone: &str,
        cursors: &HashMap<(String, String), fub_abi::traits::CivilTime>,
        timestamp: Timestamp,
    ) {
        self.reconcile_with_cursors_inner(declared, now, machine_zone, cursors, timestamp);
    }

    fn reconcile_with_cursors_inner(
        &mut self,
        declared: &[(String, fub_abi::traits::TimerSpec)],
        now: Instant,
        machine_zone: &str,
        cursors: &HashMap<(String, String), fub_abi::traits::CivilTime>,
        timestamp: Timestamp,
    ) {
        // Le coppie dichiarate, in un insieme: i due `retain` sotto le cercano
        // per appartenenza invece di rifare un `any` annidato per ogni voce.
        let declared_set: HashSet<(&str, &str)> = declared
            .iter()
            .map(|(or, spec)| (or.as_str(), spec.id.as_str()))
            .collect();
        self.quadrants
            .retain(|(owner, timer), _| declared_set.contains(&(owner.as_str(), timer.as_str())));
        self.recoveries
            .retain(|(owner, timer)| declared_set.contains(&(owner.as_str(), timer.as_str())));
        for (owner, spec) in declared {
            let key = (owner.clone(), spec.id.clone());
            let cursor = cursors.get(&key).copied();
            self.quadrants.entry(key).or_insert_with(|| Quadrant {
                schedule: spec.schedule.clone(),
                still: now,
                fired: 0,
                position: Position {
                    last: cursor,
                    wait_for: None,
                },
                next: spec
                    .schedule
                    .nth_after(0)
                    .map(|s| now + Duration::from_secs(s)),
            });
        }
        self.wall_at(now, machine_zone, timestamp);
    }

    /// Allinea i quadranti a ciò che è dichiarato **adesso**.
    ///
    /// È qui che una sveglia nasce e muore, e il fatto che la sorgente sia il
    /// manifest a ogni giro invece che una copia presa una volta è ciò che fa
    /// smettere di suonare un componente disattivato — senza che questo codice
    /// sappia niente della disattivazione.
    ///
    /// `machine_zone` è il nome IANA che il locale risolve
    /// ([`locale.timezone`](fub_kernel::locale::TIMEZONE)): vuoto = quello del
    /// sistema. Non è una chiave nuova, ed è la misura che ha risparmiato
    /// un'impostazione — vedi la decisione 0091.
    pub(super) fn reconcile_with_cursors(
        &mut self,
        declared: &[(String, fub_abi::traits::TimerSpec)],
        now: Instant,
        machine_zone: &str,
        cursors: &HashMap<(String, String), fub_abi::traits::CivilTime>,
    ) {
        self.reconcile_with_cursors_at(declared, now, machine_zone, cursors, Timestamp::now());
    }

    /// Tutto il calcolo di parete passa dal timestamp, così il banco può
    /// simulare chiusura e riavvio senza dormire davvero.
    fn wall_at(&mut self, instant: Instant, machine_zone: &str, timestamp: Timestamp) {
        for (key, q) in self.quadrants.iter_mut() {
            let Some(alarm) = q.schedule.wall_clock() else {
                continue;
            };
            let Some(zone) = Zone::of(alarm, machine_zone) else {
                q.next = None;
                continue;
            };
            let v = verdict(alarm, &zone, timestamp, q.position);
            q.position = v.position;
            q.next = v.between.map(|d| instant + d);
            if v.ring && !self.recoveries.contains(key) {
                self.recoveries.push(key.clone());
            }
        }
    }

    /// Il cursore durevole dei timer di parete, pronto per il vault.
    pub(super) fn cursors(&self) -> Vec<(String, String, fub_abi::traits::CivilTime)> {
        self.quadrants
            .iter()
            .filter_map(|((owner, timer), q)| {
                q.schedule.wall_clock().and_then(|_| {
                    q.position
                        .last
                        .map(|last| (owner.clone(), timer.clone(), last))
                })
            })
            .collect()
    }

    /// Fra quanto suona la prima. `None` = nessuna sveglia viva, e chi aspetta
    /// può dormire senza scadenza come faceva prima che le sveglie esistessero.
    pub(super) fn time_until(&self, now: Instant) -> Option<Duration> {
        self.quadrants
            .values()
            .filter_map(|q| q.next)
            .min()
            .map(|p| p.saturating_duration_since(now))
    }

    /// Chi è scaduto, con il quadrante già avanzato al giro dopo.
    pub(super) fn expired(&mut self, now: Instant, machine_zone: &str) -> Vec<(String, String)> {
        self.expired_at(now, machine_zone, Timestamp::now())
    }

    /// Versione a orologio finto per il banco di riavvio.
    pub(super) fn expired_at(
        &mut self,
        now: Instant,
        machine_zone: &str,
        timestamp: Timestamp,
    ) -> Vec<(String, String)> {
        let mut ringing = Vec::new();
        for (key, q) in self.quadrants.iter_mut() {
            if q.schedule.wall_clock().is_some() {
                continue;
            }
            let Some(next) = q.next else { continue };
            if next > now {
                continue;
            }
            ringing.push(key.clone());
            q.fired += 1;
            q.next = q
                .schedule
                .nth_after(q.fired)
                .map(|s| q.still + Duration::from_secs(s));
        }
        ringing.sort();
        self.wall_at(now, machine_zone, timestamp);
        self.recoveries.sort();
        ringing.append(&mut self.recoveries);
        ringing
    }
}
