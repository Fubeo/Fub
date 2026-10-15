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

/// Registra che il thread corrente sta per aspettare l'istanza `token`. Va
/// preso **prima** di mettersi in attesa, e tenuto finché non si è ottenuta.
pub fn wait_instance(token: usize) -> InstanceWait {
    let me = std::thread::current().id();
    graph().instance_waits.insert(me, token);
    InstanceWait { me }
}

impl Drop for InstanceWait {
    fn drop(&mut self) {
        graph().instance_waits.remove(&self.me);
    }
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
    fn what_a_thread_stops_doing_leaves_the_graph() {
        {
            let _held = hold_instance(0x77);
            assert!(holds_instance());
        }
        assert!(!holds_instance(), "l'istanza rilasciata non è più tenuta");
    }
}
