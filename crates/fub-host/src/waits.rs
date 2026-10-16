//! **Chi aspetta cosa fra il turno di scrittura e l'istanza di un componente**
//! (FUB-019).
//!
//! # Il ciclo
//!
//! Il plugin e il formato di uno stesso componente WASM condividono un'istanza,
//! cioè un `Mutex`. Il turno di scrittura del vault ([`Custody::write_turn`]) è
//! un secondo lucchetto, tenuto **attraverso** il codice dei provider
//! (decisione 0120): è voluto, perché un salvataggio è un'unità logica che
//! parser, hook, indici ed eventi non devono vedere interrotta da un altro
//! writer. I due lucchetti si prendono in ordine opposto da due parti:
//!
//! - un **salvataggio** tiene il turno e chiama il parser, un hook, un indice o
//!   un handler di evento, cioè chiede l'istanza;
//! - un **job** (o un handler, o un comando) tiene l'istanza per tutta la
//!   chiamata e, quando chiede all'host di cambiare qualcosa, chiede il turno.
//!
//! Ognuno aspetta ciò che l'altro tiene, con attese native che né la
//! cancellazione né i limiti di esecuzione del componente interrompono.
//!
//! # Perché non un ordine
//!
//! Un ordine unico (*prima il turno, poi l'istanza*) non si può imporre: il
//! turno è tenuto attraverso i provider in più di dieci punti (eventi, comandi
//! annidati, azioni di view, hook, parser, indici), e **è il guest a decidere
//! quando chiedere il turno**, già dentro l'istanza. Il mutex d'istanza non si
//! rilascia durante una chiamata all'host: lo `Store` che protegge è preso in
//! prestito da quella stessa chiamata.
//!
//! Quello che si può fare è sapere **chi aspetta chi**, e scegliere la vittima:
//! sempre il lato che sta dentro il guest, che ha un modo di dire di no (la
//! chiamata all'host ha un esito) e un modo di ritentare (è un job). Il
//! salvataggio, che è ciò che l'utente sta guardando, non fallisce.
//!
//! # Il grafo
//!
//! Tre fatti, registrati da chi li vive e tolti da chi li smette (RAII):
//!
//! - [`hold_instance`]: *questo thread tiene l'istanza `t`*;
//! - [`wait_instance`]: *questo thread aspetta l'istanza `t`*;
//! - [`wait_turn`]: *questo thread aspetta il turno, che è di quest'altro*.
//!
//! Un thread che aspetta il turno chiede [`closes_cycle`]: partendo dal
//! proprietario del turno, si segue ciò che aspetta (un'istanza → chi la tiene;
//! un altro turno → chi lo tiene) e se si torna al punto di partenza il ciclo è
//! chiuso. Il thread che lo scopre è, per costruzione, uno che tiene
//! un'istanza: è il guest, ed è lui a cedere.
//!
//! # Il ciclo puro fra istanze
//!
//! Se il turno non c'entra (A tiene X e aspetta Y, B tiene Y e aspetta X) nessuno
//! riguarda il grafo mentre aspetta, e le due attese native non finiscono mai.
//! Per questo chi aspetta un'istanza la chiede con [`try_wait_instance`], che
//! **controlla e registra sotto lo stesso lucchetto**: di due thread che si
//! chiudono a vicenda uno è l'ultimo a registrarsi, vede l'altro già in attesa e
//! riceve [`InstanceCycle`]; l'altro non ha nulla da fare. Il controllo segue
//! soltanto attese di istanze: un ciclo che passa da un turno resta di chi
//! aspetta il turno, che ha un altro verso per cedere (il salvataggio non deve
//! fallire).
//!
//! # Il lucchetto
//!
//! Il grafo sta dietro **un** mutex globale che è una **foglia**: chi lo prende
//! non prende nient'altro mentre lo tiene, quindi non può far parte di un ciclo.
//! L'unico lucchetto che lo precede è il registro del turno di una
//! [`Custody`](crate::custody::Custody), perché il ciclo si controlla mentre si
//! aspetta; nessuno prende il registro del turno tenendo il grafo.
//!
//! [`Custody::write_turn`]: crate::custody::Custody::write_turn

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::thread::ThreadId;

#[derive(Default)]
struct Graph {
    /// Istanza → thread che la tiene adesso.
    held: HashMap<usize, ThreadId>,
    /// Thread → istanza che sta aspettando.
    instance_waits: HashMap<ThreadId, usize>,
    /// Thread → thread che possiede il turno che sta aspettando.
    turn_waits: HashMap<ThreadId, ThreadId>,
}

impl Graph {
    /// Partendo da chi tiene `token`, e seguendo **solo** le attese di
    /// istanze, si arriva a `me`?
    fn instances_lead_back_to(&self, token: usize, me: ThreadId) -> bool {
        let mut seen = HashSet::new();
        let Some(mut at) = self.held.get(&token).copied() else {
            return false;
        };
        loop {
            if at == me {
                return true;
            }
            if !seen.insert(at) {
                return false;
            }
            // Chi aspetta un turno, o niente, non prolunga la catena: un ciclo
            // che passa da un turno lo scioglie chi aspetta quel turno.
            let Some(next) = self
                .instance_waits
                .get(&at)
                .and_then(|waited| self.held.get(waited))
            else {
                return false;
            };
            at = *next;
        }
    }
}

static GRAPH: LazyLock<Mutex<Graph>> = LazyLock::new(|| Mutex::new(Graph::default()));

/// Il grafo si può leggere anche dopo un panico altrui: contiene fatti su chi
/// aspetta, e ogni fatto lo toglie chi lo ha messo, anche mentre si srotola.
fn graph() -> MutexGuard<'static, Graph> {
    GRAPH
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// **Questo thread tiene l'istanza `token`** finché il valore vive.
#[must_use = "il fatto dura finché il valore vive"]
pub struct InstanceHold {
    token: usize,
}

/// Registra che il thread corrente tiene l'istanza `token`: l'identità è
/// l'indirizzo del suo `Mutex`.
pub fn hold_instance(token: usize) -> InstanceHold {
    graph().held.insert(token, std::thread::current().id());
    InstanceHold { token }
}

impl Drop for InstanceHold {
    fn drop(&mut self) {
        graph().held.remove(&self.token);
    }
}

/// **Questo thread aspetta l'istanza** finché il valore vive.
#[must_use = "il fatto dura finché il valore vive"]
pub struct InstanceWait {
    me: ThreadId,
}

/// Registra che il thread corrente sta per aspettare l'istanza `token`, **senza
/// controllare** che l'attesa chiuda un ciclo. Serve a chi mette in scena un
/// grafo nei banchi; chi aspetta davvero un'istanza usa [`try_wait_instance`].
#[doc(hidden)]
pub fn wait_instance(token: usize) -> InstanceWait {
    let me = std::thread::current().id();
    graph().instance_waits.insert(me, token);
    InstanceWait { me }
}

/// Aspettare l'istanza chiuderebbe un ciclo di sole istanze: chi la tiene
/// aspetta, di seguito, qualcosa che questo thread tiene. Nessuno dei due si
/// muoverebbe mai.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstanceCycle;

/// **Aspettare l'istanza `token`, se non chiude un ciclo.**
///
/// Il controllo e la registrazione stanno sotto lo stesso lucchetto del grafo:
/// di due thread che si aspettano a vicenda, uno solo può vedere l'altro già in
/// attesa, ed è lui a ricevere l'errore. Va preso **prima** di mettersi in
/// attesa e tenuto finché l'istanza non si è ottenuta.
pub fn try_wait_instance(token: usize) -> Result<InstanceWait, InstanceCycle> {
    let me = std::thread::current().id();
    let mut graph = graph();
    if graph.instances_lead_back_to(token, me) {
        return Err(InstanceCycle);
    }
    graph.instance_waits.insert(me, token);
    Ok(InstanceWait { me })
}

impl Drop for InstanceWait {
    fn drop(&mut self) {
        graph().instance_waits.remove(&self.me);
    }
}

/// Questo `thread` sta aspettando un'istanza adesso? Una sonda, non una porta:
/// dice un fatto del grafo, non dà modo di cambiarlo. Serve ai banchi che
/// fissano l'ordine fra due thread aspettando un fatto invece di un orologio.
///
/// Si chiede di **un thread** perché il grafo è del processo: più prove nello
/// stesso processo non devono vedere le attese le une delle altre.
#[doc(hidden)]
pub fn thread_waits_for_an_instance(thread: ThreadId) -> bool {
    graph().instance_waits.contains_key(&thread)
}

/// **Questo thread aspetta il turno di un altro** finché il valore vive.
#[must_use = "il fatto dura finché il valore vive"]
pub(crate) struct TurnWait {
    me: ThreadId,
}

/// Registra che il thread corrente aspetta il turno di `owner`. Si richiama a
/// ogni giro: il turno passa di mano mentre si aspetta.
pub(crate) fn wait_turn(owner: ThreadId) -> TurnWait {
    let me = std::thread::current().id();
    graph().turn_waits.insert(me, owner);
    TurnWait { me }
}

impl TurnWait {
    pub(crate) fn now_owned_by(&self, owner: ThreadId) {
        graph().turn_waits.insert(self.me, owner);
    }
}

impl Drop for TurnWait {
    fn drop(&mut self) {
        graph().turn_waits.remove(&self.me);
    }
}

/// Il thread corrente tiene almeno un'istanza? Cioè: sta eseguendo codice di un
/// componente, e un'attesa che non può rifiutare è un'attesa che può chiudere
/// un ciclo.
pub(crate) fn holds_instance() -> bool {
    let me = std::thread::current().id();
    graph().held.values().any(|holder| *holder == me)
}

/// **Aspettare il turno di `owner` chiude un ciclo che passa da me?**
///
/// Si parte da chi ha il turno e si segue ciò che aspetta: un'istanza porta a chi
/// la tiene, un turno porta a chi lo possiede. Se si arriva a `me`, chi ha il
/// turno aspetta qualcosa che io tengo e io aspetto ciò che ha lui: nessuno dei
/// due si muoverà.
pub(crate) fn closes_cycle(owner: ThreadId) -> bool {
    let me = std::thread::current().id();
    let graph = graph();
    let mut seen = HashSet::new();
    let mut at = owner;
    loop {
        if at == me {
            return true;
        }
        if !seen.insert(at) {
            // Un ciclo che non passa da me: non è mio da sciogliere, e chi ci
            // sta dentro lo vedrà dal suo lato.
            return false;
        }
        at = if let Some(token) = graph.instance_waits.get(&at) {
            match graph.held.get(token) {
                Some(holder) => *holder,
                None => return false,
            }
        } else if let Some(next) = graph.turn_waits.get(&at) {
            *next
        } else {
            return false;
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// Un thread che tiene un'istanza e aspetta il turno di un altro, a mano: il
    /// grafo si prova senza `Custody` né componenti.
    fn spawn_parked(
        run: impl FnOnce(mpsc::Sender<ThreadId>, mpsc::Receiver<()>) + Send + 'static,
    ) -> (ThreadId, mpsc::Sender<()>, std::thread::JoinHandle<()>) {
        let (id_tx, id_rx) = mpsc::channel();
        let (go_tx, go_rx) = mpsc::channel();
        let handle = std::thread::spawn(move || run(id_tx, go_rx));
        let id = id_rx.recv().unwrap();
        (id, go_tx, handle)
    }

    #[test]
    fn a_turn_whose_owner_waits_for_my_instance_closes_a_cycle() {
        // `me` (questo thread) tiene l'istanza 0xA e aspetta il turno di B; B
        // aspetta l'istanza 0xA.
        let _held = hold_instance(0xA);
        let (b, release, handle) = spawn_parked(|id, go| {
            let _wait = wait_instance(0xA);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        assert!(closes_cycle(b), "B aspetta ciò che tengo: ciclo");
        release.send(()).unwrap();
        handle.join().unwrap();
        assert!(!closes_cycle(b), "B non aspetta più: nessun ciclo");
    }

    #[test]
    fn an_owner_that_waits_for_somebody_else_is_not_a_cycle() {
        let _held = hold_instance(0xB);
        // B aspetta un'istanza (0xC) che tiene C, e C non aspetta niente.
        let (c, release_c, handle_c) = spawn_parked(|id, go| {
            let _held = hold_instance(0xC);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        let (b, release_b, handle_b) = spawn_parked(|id, go| {
            let _wait = wait_instance(0xC);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        assert!(!closes_cycle(b), "B aspetta C, che non aspetta me");
        assert!(!closes_cycle(c), "C non aspetta niente");
        release_b.send(()).unwrap();
        release_c.send(()).unwrap();
        handle_b.join().unwrap();
        handle_c.join().unwrap();
    }

    #[test]
    fn a_chain_through_a_third_thread_closes_the_cycle() {
        // Io tengo 0xD. B aspetta 0xE, che tiene C; C aspetta 0xD, che tengo io.
        let _held = hold_instance(0xD);
        let (_c, release_c, handle_c) = spawn_parked(|id, go| {
            let _held = hold_instance(0xE);
            let _wait = wait_instance(0xD);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        let (b, release_b, handle_b) = spawn_parked(|id, go| {
            let _wait = wait_instance(0xE);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        assert!(closes_cycle(b), "B → 0xE → C → 0xD → io");
        release_b.send(()).unwrap();
        release_c.send(()).unwrap();
        handle_b.join().unwrap();
        handle_c.join().unwrap();
    }

    #[test]
    fn a_cycle_that_does_not_pass_through_me_is_not_mine_to_break() {
        // B e C si aspettano a vicenda; io non c'entro.
        let (_c, release_c, handle_c) = spawn_parked(|id, go| {
            let _held = hold_instance(0xF1);
            let _wait = wait_instance(0xF2);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        let (b, release_b, handle_b) = spawn_parked(|id, go| {
            let _held = hold_instance(0xF2);
            let _wait = wait_instance(0xF1);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        assert!(!closes_cycle(b), "il ciclo di B e C non passa da me");
        release_b.send(()).unwrap();
        release_c.send(()).unwrap();
        handle_b.join().unwrap();
        handle_c.join().unwrap();
    }

    #[test]
    fn the_last_of_two_instances_waiting_for_each_other_is_refused() {
        // Io tengo 0x10 e aspetto 0x20; B tiene 0x20 e vorrebbe 0x10.
        let _held = hold_instance(0x10);
        let (ready_tx, ready_rx) = mpsc::channel();
        let (go_tx, go_rx) = mpsc::channel::<()>();
        let b = std::thread::spawn(move || {
            let _held = hold_instance(0x20);
            ready_tx.send(()).unwrap();
            go_rx.recv().unwrap();
            // Io aspetto già 0x20: aspettare 0x10 chiude il ciclo.
            let outcome = try_wait_instance(0x10).err();
            let waits = thread_waits_for_an_instance(std::thread::current().id());
            (outcome, waits)
        });
        ready_rx.recv().unwrap();
        let _wait = try_wait_instance(0x20).expect("B non aspetta ancora niente");
        go_tx.send(()).unwrap();
        let (outcome, waits) = b.join().unwrap();
        assert_eq!(outcome, Some(InstanceCycle), "l'ultimo a registrarsi cede");
        assert!(!waits, "chi è stato rifiutato non resta nel grafo");
        assert!(
            thread_waits_for_an_instance(std::thread::current().id()),
            "chi ha registrato per primo aspetta davvero"
        );
    }

    #[test]
    fn a_chain_of_instances_is_followed_to_the_end() {
        // Io tengo 0x30; B tiene 0x31 e aspetta 0x32; C tiene 0x32 e aspetta 0x30.
        // Io che aspetto 0x31 chiuderei il giro.
        let _held = hold_instance(0x30);
        let (_c, release_c, handle_c) = spawn_parked(|id, go| {
            let _held = hold_instance(0x32);
            let _wait = wait_instance(0x30);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        let (_b, release_b, handle_b) = spawn_parked(|id, go| {
            let _held = hold_instance(0x31);
            let _wait = wait_instance(0x32);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        assert_eq!(try_wait_instance(0x31).err(), Some(InstanceCycle));
        release_b.send(()).unwrap();
        release_c.send(()).unwrap();
        handle_b.join().unwrap();
        handle_c.join().unwrap();
    }

    #[test]
    fn waiting_for_an_instance_nobody_holds_or_that_leads_elsewhere_is_allowed() {
        assert!(try_wait_instance(0x40).is_ok(), "nessuno la tiene");
        let (_c, release_c, handle_c) = spawn_parked(|id, go| {
            let _held = hold_instance(0x41);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        assert!(
            try_wait_instance(0x41).is_ok(),
            "chi la tiene non aspetta me"
        );
        release_c.send(()).unwrap();
        handle_c.join().unwrap();
    }

    #[test]
    fn a_turn_in_the_chain_is_left_to_whoever_waits_for_the_turn() {
        // B tiene 0x50 e aspetta il turno di un terzo: la catena istanza → turno
        // non è una catena di sole istanze, e non è questo thread a sciogliere
        // un ciclo che passa dal turno.
        let me = std::thread::current().id();
        let _held = hold_instance(0x51);
        let (_b, release, handle) = spawn_parked(move |id, go| {
            let _held = hold_instance(0x50);
            let _turn = wait_turn(me);
            id.send(std::thread::current().id()).unwrap();
            go.recv().unwrap();
        });
        assert!(try_wait_instance(0x50).is_ok());
        release.send(()).unwrap();
        handle.join().unwrap();
    }

    #[test]
    fn what_a_thread_stops_doing_leaves_the_graph() {
        {
            let _held = hold_instance(0x77);
            assert!(holds_instance());
        }
        assert!(!holds_instance(), "l'istanza rilasciata non è più tenuta");
    }
}
