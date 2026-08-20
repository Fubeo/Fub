//! **Un lucchetto del kernel sta dietro una porta, e questa porta si riprende.**
//!
//! È la [0126](../../../docs/decisions/0126-un-bus-che-tace-non-lo-scopre-nessuno.md)
//! applicata fuori da `bus.rs`, con la regola che la
//! [0120](../../../docs/decisions/0120-un-lucchetto-avvelenato-si-dice-una-volta.md)
//! ha scritto per renderla decidibile: *la politica del veleno segue **cosa il
//! lucchetto protegge**, non che specie di lucchetto è.*
//!
//! `Custody` (in `fub-host`) risponde `Internal` a ogni chiamata, perché
//! protegge un `Workspace` — uno stato che un panico a metà mutazione rende
//! incredibile — e perché c'è qualcuno a cui rispondere. Qui non vale né l'una
//! né l'altra:
//!
//! - ciò che questi lucchetti proteggono è un conto monotòno, un elenco di
//!   stringhe, un file aperto col suo contatore di byte. Nessuno dei tre è
//!   *mezzo mutato* da un panico: al peggio manca l'ultimo incremento;
//! - **non c'è nessuno a cui rispondere.** `Sink::write_line` non rende niente,
//!   `Levels::enabled` rende un `bool` che è una domanda e non un esito,
//!   `JobBell::ring` rende `()`. «Rispondi di no» qui è «taci», e la 0126 ha già
//!   misurato che tacere non è una politica.
//!
//! Quindi: **ci si riprende, si pulisce il veleno, e si conta.**
//!
//! # Perché la porta conta e non parla
//!
//! `Roster` (in `bus.rs`) scrive la sua riga di `tracing::error!` da sé. Questa
//! porta **non può**, e non è una semplificazione: fra i suoi clienti c'è il
//! collettore del log ([`crate::log`]). Un `tracing::error!` scritto dentro
//! [`Shelter::acquire`] mentre chi chiama è `FileSink::write_line` rientrerebbe
//! nel collettore, che richiederebbe lo stesso lucchetto dallo stesso thread:
//! non un difetto, un **blocco**. E dentro `Levels::enabled` sarebbe la stessa
//! cosa un piano più su.
//!
//! Una porta che non sa chi la chiama non sa se parlare sia sicuro. Quindi la
//! porta garantisce le due cose che valgono per tutti — *non pania mai*, *tiene
//! il conto* — e **dove** raccontarlo lo sceglie il sito, che sa in che canale
//! si trova. [`Shelter::unreported`] è il modo di dirlo una volta per
//! incidente senza che la porta debba saperlo: `FileSink` lo usa per scrivere la
//! riga **nel proprio file**, direttamente, saltando il collettore — che è
//! l'unica risposta non circolare a *«dove si denuncia che è morto il canale con
//! cui si denuncia?»*.
//!
//! # Perché tre tipi e non uno
//!
//! Perché i lucchetti che ci stanno sotto sono davvero diversi, ed è la premessa
//! che la 0120 ha visto cadere a metà lavoro: **un `RwLock` non è «un `Mutex`
//! con un permesso in più»**. `Mutex<T>` è `Sync` per ogni `T: Send`;
//! `RwLock<T>` lo è solo per `T: Send + Sync`, perché presta `&T` a più thread
//! insieme. `Workspace::sources` tiene dei `Box<dyn SourceBacking>` — `Sync` non
//! è, e non deve diventarlo per una tabella che un thread solo tocca — quindi il
//! tipo su `RwLock` là non ci entra, e il tipo su `Mutex` nel filtro del log
//! metterebbe in fila ogni callsite di `tracing`. Da qui [`Shelter`] e
//! [`SharedShelter`], che non si sostituiscono.
//!
//! Il terzo è [`Condition`], e non ha un lucchetto suo: **è un [`Shelter`] con
//! una campana sopra**, e la sua politica è quella, non una seconda copia.
//! Esiste come tipo perché [`std::sync::Condvar`] è definita su `MutexGuard` e
//! su niente altro — `wait` restituisce la stessa guardia che ha ricevuto. È la
//! ragione `Condition` dell'allowlist di `un_lucchetto_solo.rs`, che fin qui
//! era **un commento** e qui diventa un tipo.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{
    Condvar, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard,
};

/// **Un lucchetto che si riprende**, per un dato che un panico a metà non rende
/// incredibile.
///
/// `.lock()` su un `Shelter` non esiste, quindi non compila: si passa da
/// [`acquire`](Shelter::prendi), e la domanda «cosa si fa se è avvelenato?» ha
/// una risposta sola, scritta una volta.
#[derive(Debug, Default)]
pub struct Shelter<T> {
    inner: Mutex<T>,
    /// Quante volte questo lucchetto si è ripreso. È **del lucchetto** e non
    /// del processo: due sink aperti sono due stati, e sapere che uno si è
    /// avvelenato non dice niente dell'altro.
    reports: AtomicU32,
    /// Quante ne sono già state raccontate. Vedi [`Shelter::unreported`].
    reported: AtomicU32,
}

impl<T> Shelter<T> {
    /// Il lucchetto attorno a `data`.
    pub const fn new(data: T) -> Shelter<T> {
        Shelter {
            inner: Mutex::new(data),
            reports: AtomicU32::new(0),
            reported: AtomicU32::new(0),
        }
    }

    /// Il prestito. Non pania: se è avvelenato si riprende.
    pub fn acquire(&self) -> MutexGuard<'_, T> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poison) => self.recover(poison),
        }
    }

    /// Quante volte si è ripreso, da sempre.
    pub fn reports(&self) -> u32 {
        self.reports.load(Ordering::Relaxed)
    }

    /// Gli avvelenamenti che **nessuno ha ancora raccontato** — e che da adesso
    /// risultano raccontati.
    ///
    /// È ciò che rende «una volta per incidente» vero senza che la porta debba
    /// sapere *dove* si racconta: lo sa il sito, che sa in che canale si trova.
    /// Zero è il caso normale, e un sito che non chiama mai questo metodo
    /// degrada in silenzio col conto di [`reports`](Shelter::denunce) come sola
    /// traccia — il che va bene finché è **scritto** che è così.
    /// traccia — il che va bene finché è **scritto** che è così.
    pub fn unreported(&self) -> u32 {
        let reports = self.reports.load(Ordering::Relaxed);
        reports.saturating_sub(self.reported.swap(reports, Ordering::Relaxed))
    }

    /// La politica, in un posto solo: **riprenditi, pulisci, conta.**
    ///
    /// `clear_poison` fa sì che il conto sia *per avvelenamento* e non per
    /// sempre: un secondo panico è un secondo incidente e vale due.
    /// È **generica su cosa il veleno porta dentro** perché i tre modi di
    /// prendere questo lucchetto ne portano due: `lock` e `Condvar::wait_while`
    /// una guardia, `Condvar::wait_timeout_while` una guardia e l'esito del
    /// tempo. [`Condition`] ci passa dentro, ed è ciò che le fa ereditare
    /// questa politica invece di riscriverla.
    #[cold]
    fn recover<V>(&self, poison: PoisonError<V>) -> V {
        self.inner.clear_poison();
        self.reports.fetch_add(1, Ordering::Relaxed);
        poison.into_inner()
    }
}

/// **Lo stesso, per un dato che si legge molto più di quanto si scriva.**
///
/// Un `RwLock` e non un `Mutex` **non** è «un `Shelter` con un permesso in
/// più»: è la premessa che la 0120 ha visto cadere a metà lavoro, perché
/// `Mutex<T>` è `Sync` per ogni `T: Send` mentre `RwLock<T>` lo è solo per
/// `T: Send + Sync` — presta `&T` a più thread insieme. Quindi i due tipi non si
/// sostituiscono, e ce ne vogliono due: `Workspace::sources` tiene dei
/// `Box<dyn SourceBacking>`, che `Sync` non è e non deve diventarlo per una
/// tabella che un thread solo tocca.
///
/// Qui il cliente è uno e la ragione è misurata: [`crate::log::Levels`] è il
/// filtro di **ogni** callsite di `tracing`, e metterli in fila costerebbe a chi
/// non chiede niente.
#[derive(Debug, Default)]
pub struct SharedShelter<T> {
    inner: RwLock<T>,
    reports: AtomicU32,
}

impl<T> SharedShelter<T> {
    /// Il lucchetto attorno a `data`.
    pub const fn new(data: T) -> SharedShelter<T> {
        SharedShelter {
            inner: RwLock::new(data),
            reports: AtomicU32::new(0),
        }
    }

    /// Il prestito condiviso. Non pania: se è avvelenato si riprende.
    pub fn read(&self) -> RwLockReadGuard<'_, T> {
        match self.inner.read() {
            Ok(guard) => guard,
            Err(poison) => self.recover(poison),
        }
    }

    /// Il prestito esclusivo. Non pania: se è avvelenato si riprende.
    pub fn write(&self) -> RwLockWriteGuard<'_, T> {
        match self.inner.write() {
            Ok(guard) => guard,
            Err(poison) => self.recover(poison),
        }
    }

    /// Quante volte si è ripreso, da sempre.
    pub fn reports(&self) -> u32 {
        self.reports.load(Ordering::Relaxed)
    }

    #[cold]
    fn recover<V>(&self, poison: PoisonError<V>) -> V {
        self.inner.clear_poison();
        self.reports.fetch_add(1, Ordering::Relaxed);
        poison.into_inner()
    }
}

/// **Un lucchetto che si riprende, e una condizione da aspettarci sopra.**
///
/// Stessa politica del [`Shelter`], e un `Mutex` al posto del `RwLock` per la
/// ragione scritta in testa al modulo: la `Condvar` restituisce la guardia che
/// ha ricevuto, e la guardia di un `RwLock` non si mette in attesa.
#[derive(Debug, Default)]
pub struct Condition<T> {
    state: Shelter<T>,
    bell: Condvar,
}

impl<T> Condition<T> {
    /// Il lucchetto attorno a `data`, con la sua campana.
    pub const fn new(data: T) -> Condition<T> {
        Condition {
            state: Shelter::new(data),
            bell: Condvar::new(),
        }
    }

    /// Prende lo stato. Non pania: se è avvelenato si riprende.
    pub fn acquire(&self) -> MutexGuard<'_, T> {
        self.state.acquire()
    }

    /// Cambia lo stato e **sveglia tutti**.
    ///
    /// `notify_all` e non `notify_one`: chi aspetta una condizione può essere
    /// più d'uno, e un fatto già avvenuto non si ripete. Svegliarne uno solo
    /// lascerebbe gli altri fermi davanti a qualcosa che è già successo — che è
    /// il genere di attesa che non scade mai.
    ///
    /// # La campana suona anche uscendo per srotolamento
    ///
    /// La suonata sta in un `Drop` e non su una riga dopo `f`, perché su quella
    /// riga passa tutto ciò che pania: `f` riceve `&mut T` e ci può morire
    /// dentro. Chi aspettava restava appeso **per sempre** — un `Condvar` non
    /// scade da sé — e il panico che l'aveva causato era già stato inghiottito
    /// dal `Mutex` avvelenato, cioè nessuno diceva niente a nessuno. Un `Drop` è
    /// l'unica cosa che vede tutte le strade d'uscita, e la eredita chiunque
    /// aggiunga un secondo modo di cambiare lo stato: non c'è una suonata da
    /// ricordarsi di chiamare.
    ///
    /// **Cosa vede chi si sveglia dopo un panico: lo stato come `f` lo ha
    /// lasciato**, non quello di prima. Non è una resa a ciò che il tipo sa
    /// fare — anche potendo, tornare indietro sarebbe la risposta sbagliata
    /// qui — ed è la stessa premessa scritta in testa al modulo: ciò che questi
    /// lucchetti proteggono è un conto monotòno, che un panico a metà non rende
    /// incredibile, e chi aspetta lo riguarda con la sua condizione. Al peggio
    /// manca l'ultimo incremento, e la sveglia in più è una sveglia, non un
    /// lavoro (vedi [`crate::dispatcher::JobBell`]). Un dato che il mezzo
    /// cambiamento renderebbe incredibile non va dietro un `Shelter`: va dietro
    /// una `Custody`, che risponde di no.
    pub fn change(&self, f: impl FnOnce(&mut T)) {
        // Dichiarata **prima**, quindi cade **dopo**: il prestito è già stato
        // reso quando la campana suona — su tutte e due le strade — e chi si
        // sveglia trova il lucchetto libero invece di rimettersi in fila.
        let _bell = Ring(&self.bell);
        f(&mut self.acquire());
    }

    /// Aspetta finché `still` resta vero. Non pania: se il lucchetto si
    /// avvelena mentre si aspetta, si riprende e continua.
    pub fn wait<'a>(
        &'a self,
        state: MutexGuard<'a, T>,
        still: impl FnMut(&mut T) -> bool,
    ) -> MutexGuard<'a, T> {
        match self.bell.wait_while(state, still) {
            Ok(guard) => guard,
            Err(poison) => self.state.recover(poison),
        }
    }

    /// Come [`wait`](Condition::aspetta), ma non oltre `timeout`. La guardia
    /// torna comunque: chi chiama guarda lo stato e decide se era il tempo o il
    /// fatto.
    pub fn wait_or<'a>(
        &'a self,
        state: MutexGuard<'a, T>,
        timeout: std::time::Duration,
        still: impl FnMut(&mut T) -> bool,
    ) -> MutexGuard<'a, T> {
        match self.bell.wait_timeout_while(state, timeout, still) {
            Ok((guard, _expired)) => guard,
            Err(poison) => self.state.recover(poison).0,
        }
    }

    /// Quante volte si è ripreso, da sempre. È il conto del [`Shelter`] che sta
    /// sotto: la politica è **una sola**, e questa è la prova che non è stata
    /// riscritta.
    pub fn reports(&self) -> u32 {
        self.reports_underneath()
    }

    fn reports_underneath(&self) -> u32 {
        self.state.reports()
    }
}

/// **Una campana da suonare cadendo**, per [`Condition::change`].
///
/// Non prende il lucchetto e non lo vuole: `notify_all` non chiede la guardia, e
/// suonare tenendola in mano rimetterebbe in fila chi si sveglia. Vive quanto la
/// chiamata, e la sua unica ragione è che *nessuna* strada d'uscita la salti.
/// chiamata, e la sua unica ragione è che *nessuna* strada d'uscita la salti.
struct Ring<'c>(&'c Condvar);

impl Drop for Ring<'_> {
    fn drop(&mut self) {
        self.0.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::Arc;

    /// Avvelena `f` facendo paniare **dentro** un `catch_unwind`, col prestito
    /// in mano: è come lo produce la vita, e non serve un thread.
    ///
    /// L'hook dei panici si mette a tacere per la durata del misfatto, o un
    /// panico voluto stamperebbe la sua traccia e farebbe sembrare rotto un
    /// banco verde (la stessa cautela di `un_lucchetto_solo.rs`).
    fn poison(f: impl FnOnce()) {
        let old = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = catch_unwind(AssertUnwindSafe(f));
        std::panic::set_hook(old);
    }

    #[test]
    fn a_poisoned_shelter_still_lends_and_counts() {
        let r = Shelter::new(vec!["a".to_string()]);
        poison(|| {
            let _g = r.acquire();
            panic!("someone dies holding the loan");
        });
        // Le due prove insieme: **non pania** (se paniasse il test fallirebbe
        // qui) e ciò che c'era è ancora là.
        assert_eq!(r.acquire().len(), 1);
        r.acquire().push("b".into());
        assert_eq!(r.acquire().len(), 2);
        assert_eq!(
            r.reports(),
            1,
            "one incident counts one, not one per call"
        );
    }

    /// Il gemello su `RwLock`, e serve perché è **un altro tipo**: la 0120 ha
    /// visto cadere la premessa che un `RwLock` fosse «un `Mutex` con un
    /// permesso in più», e due tipi si rompono separatamente. Qui si prova anche
    /// il verso che il `Mutex` non ha: **un lettore non avvelena**, quindi il
    /// misfatto va fatto col prestito esclusivo.
    #[test]
    fn a_poisoned_shared_shelter_still_lends_and_counts() {
        let r = SharedShelter::new(vec!["a".to_string()]);
        poison(|| {
            let _g = r.write();
            panic!("someone dies holding the exclusive loan");
        });
        assert_eq!(r.read().len(), 1);
        r.write().push("b".into());
        assert_eq!(r.read().len(), 2);
        assert_eq!(r.reports(), 1);
    }

    #[test]
    fn a_second_incident_counts_two() {
        let r = Shelter::new(0u32);
        for _ in 0..2 {
            poison(|| {
                let _g = r.acquire();
                panic!("boom");
            });
            // Prendere il prestito è ciò che pulisce il veleno: senza questa
            // riga il secondo panico troverebbe il lucchetto già sporco e
            // `clear_poison` non avrebbe niente da dire.
            drop(r.acquire());
        }
        assert_eq!(r.reports(), 2);
    }

    #[test]
    fn reported_once_for_incident() {
        let r = Shelter::new(0u32);
        assert_eq!(
            r.unreported(),
            0,
            "no incidents means nothing to report"
        );
        poison(|| {
            let _g = r.acquire();
            panic!("boom");
        });
        drop(r.acquire());
        assert_eq!(r.unreported(), 1);
        assert_eq!(
            r.unreported(),
            0,
            "reporting twice would be reporting two"
        );
        assert_eq!(r.reports(), 1, "the total count is not consumed");
    }

    #[test]
    fn a_poisoned_condition_still_wakes() {
        let c = Arc::new(Condition::new(0u64));
        poison(|| {
            let _g = c.acquire();
            panic!("someone dies holding the condition");
        });
        // Chi aspetta parte **prima** che il fatto avvenga, e il fatto lo
        // produce questo thread: la corsa si costruisce, non si aspetta.
        let waker = {
            let c = Arc::clone(&c);
            std::thread::spawn(move || {
                let state = c.acquire();
                *c.wait(state, |q| *q == 0)
            })
        };
        c.change(|q| *q += 1);
        assert_eq!(
            waker.join().expect("the waiter reached the end"),
            1
        );
        assert_eq!(c.reports(), 1);
    }

    /// **Chi muore cambiando lo stato sveglia lo stesso chi aspettava.**
    ///
    /// È il difetto che il `Drop` di `Ring` esiste per non avere: con la
    /// suonata scritta come una riga *dopo* `f`, un panico dentro `f` la
    /// saltava, e chi dormiva sulla campana non veniva svegliato da nessuno —
    /// per sempre, perché un `Condvar` non scade da sé e il panico era già stato
    /// inghiottito dal lucchetto avvelenato.
    ///
    /// Il risveglio si aspetta su un canale con un tetto di tempo e **non** con
    /// un `join`: senza la riparazione un `join` resterebbe appeso insieme a chi
    /// aspetta, e un banco che si blocca non è un banco rosso.
    #[test]
    fn dying_while_changing_still_wakes() {
        // Lo stato porta anche «sono dentro l'attesa», e non è un dettaglio del
        // banco: senza, il misfatto potrebbe arrivare *prima* che l'altro thread
        // si addormenti, e allora quello si sveglierebbe da sé riguardando la
        // condizione — cioè il banco sarebbe verde anche senza la riparazione,
        // una volta ogni tanto. La bandiera si alza **sotto il lucchetto**, e
        // l'unico posto in cui quel lucchetto si rende è dentro `wait_while`:
        // vederla alzata da qui vuol dire che chi aspetta sta dormendo davvero.
        // vederla alzata da qui vuol dire che chi aspetta sta dormendo davvero.
        let c = Arc::new(Condition::new((0u64, false)));
        let (tx, rx) = std::sync::mpsc::channel();
        let waker = {
            let c = Arc::clone(&c);
            std::thread::spawn(move || {
                let mut state = c.acquire();
                state.1 = true;
                let seen = c.wait(state, |s| s.0 == 0).0;
                let _ = tx.send(seen);
            })
        };
        while !c.acquire().1 {
            std::thread::yield_now();
        }
        poison(|| {
            c.change(|s| {
                s.0 += 1;
                panic!("someone dies changing the state");
            });
        });
        let seen = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect(
                "nobody rang the bell: the waiter is stuck on a condition that
                 already changed, and will hang until the process dies",
            );
        assert_eq!(seen, 1, "it sees the state as the panic left it");
        waker.join().expect("the waiter reached the end");
        assert_eq!(c.reports(), 1);
    }

    #[test]
    fn a_poisoned_condition_times_out() {
        let c = Condition::new(7u64);
        poison(|| {
            let _g = c.acquire();
            panic!("boom");
        });
        let state = c.acquire();
        // Nessuno cambierà lo stato: si prova che l'attesa **torna** invece di
        // paniare sul veleno, e che torna col valore che c'era.
        // paniare sul veleno, e che torna col valore che c'era.
        let out = c.wait_or(state, std::time::Duration::from_millis(1), |q| *q == 7);
        assert_eq!(*out, 7);
        assert_eq!(c.reports(), 1);
    }
}
