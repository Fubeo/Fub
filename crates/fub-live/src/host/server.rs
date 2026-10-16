//! Il supervisore: accetta i socket, fa scattare le scadenze, e alla fine
//! chiude tutto.
//!
//! I compiti delle connessioni stanno in un `JoinSet` del supervisore: un
//! panic resta nel suo compito (la guardia della connessione avvisa la
//! sessione), e alla chiusura nessun compito sopravvive. Quando il
//! supervisore restituisce il rapporto, il listener è chiuso, ogni compito è
//! finito e la porta è libera.

use std::io;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinSet;
use tokio::time::{sleep, sleep_until, timeout_at, Instant};

use super::api::StopReport;
use super::conn::{serve, Io};
use super::events::{EndReason, LiveEvent};
use super::{Alive, Shared};
use crate::limits::{CLOSE_GRACE, MAX_HANDSHAKES};

/// Da dove arrivano i socket.
pub(crate) enum Listener {
    Tcp(TcpListener),
    /// Le prove con il tempo in pausa: un tubo in memoria non fa avanzare
    /// l'orologio mentre i dati viaggiano, un socket vero sì.
    #[cfg(test)]
    Memory(tokio::sync::mpsc::UnboundedReceiver<Box<dyn Io>>),
}

impl Listener {
    async fn accept(&mut self) -> io::Result<Box<dyn Io>> {
        match self {
            Listener::Tcp(listener) => {
                let (stream, _) = listener.accept().await?;
                // Gli heartbeat e i messaggi piccoli non aspettano Nagle.
                stream.set_nodelay(true)?;
                Ok(Box::new(stream))
            }
            #[cfg(test)]
            Listener::Memory(incoming) => match incoming.recv().await {
                Some(stream) => Ok(stream),
                None => std::future::pending().await,
            },
        }
    }
}

/// Il tempo concesso ai compiti per chiudersi da soli, oltre la chiusura
/// ordinata di ciascuno: poi si interrompono.
const TEARDOWN_SLACK: Duration = Duration::from_millis(500);

/// L'attesa dopo un errore di `accept`, che di solito è un limite del sistema
/// (descrittori finiti) e si ripeterebbe subito.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

pub(crate) async fn supervise(
    shared: Arc<Shared>,
    mut listener: Listener,
    mut stop: watch::Receiver<Option<EndReason>>,
) -> StopReport {
    let _alive = Alive::new(&shared.tasks);
    let handshakes = Arc::new(Semaphore::new(MAX_HANDSHAKES));
    let mut tasks = JoinSet::new();
    let mut next_conn = 1;
    let requested = loop {
        let deadline = shared.session.lock().next_deadline();
        tokio::select! {
            biased;
            changed = stop.changed() => {
                // Il `LiveHost` caduto senza `stop` chiude come l'app.
                let requested = if changed.is_ok() { *stop.borrow_and_update() } else { None };
                match (changed, requested) {
                    (Ok(()), Some(reason)) => break reason,
                    (Ok(()), None) => {}
                    (Err(_), _) => break EndReason::HostClosing,
                }
            }
            () = wait_until(deadline) => shared.session.lock().tick(Instant::now()),
            () = shared.wake.notified() => {}
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
            accepted = listener.accept() => match accepted {
                Ok(io) => {
                    shared.session.lock().accepted();
                    match handshakes.clone().try_acquire_owned() {
                        Ok(permit) => {
                            tasks.spawn(serve(shared.clone(), io, next_conn, permit));
                            next_conn += 1;
                        }
                        Err(_) => shared.session.lock().refused(),
                    }
                }
                Err(_) => sleep(ACCEPT_BACKOFF).await,
            },
        }
    };

    // Niente più socket nuovi; la connessione dello scrittore si chiude con
    // il codice del motivo.
    drop(listener);
    let reason = {
        let mut session = shared.session.lock();
        session.end(requested);
        session.end_reason().unwrap_or(requested)
    };
    let slack = Instant::now() + CLOSE_GRACE + TEARDOWN_SLACK;
    while let Ok(Some(_)) = timeout_at(slack, tasks.join_next()).await {}
    tasks.shutdown().await;
    let pending = shared.session.lock().pending();
    shared.events.close_with(Some(LiveEvent::Ended { reason }));
    StopReport { pending }
}

async fn wait_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}
