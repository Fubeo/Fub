//! Una rete in memoria per le prove con il tempo in pausa.
//!
//! Con un socket vero il runtime, mentre aspetta i dati, crede di non avere
//! niente da fare e fa avanzare l'orologio in pausa fino alla prossima
//! scadenza: un heartbeat scatterebbe prima che il `pong` arrivi. Un tubo in
//! memoria sveglia i compiti dentro il runtime, e l'orologio avanza solo
//! quando tutti aspettano davvero il tempo.
//!
//! Le prove guastano la rete dal lato del client: la tagliano, come un Wi-Fi
//! che cade, o la rendono muta, come un tablet che si addormenta con la
//! connessione aperta; e possono rifiutare le connessioni nuove.

use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll, Waker};

use parking_lot::Mutex;
use tokio::io::{AsyncRead, AsyncWrite, DuplexStream, ReadBuf};
use tokio::sync::mpsc;

use crate::host::Io;

/// I byte in volo in ciascuna direzione di un tubo.
const PIPE: usize = 256 * 1024;

const OPEN: u8 = 0;
const CUT: u8 = 1;
const SILENT: u8 = 2;

/// Lo stato di una linea, condiviso fra il capo del client e la rete.
#[derive(Default)]
struct Line {
    mode: AtomicU8,
    /// Chi aspetta sul capo del client, da svegliare quando la linea cambia.
    wakers: Mutex<Vec<Waker>>,
}

impl Line {
    fn mode(&self) -> u8 {
        self.mode.load(Ordering::Acquire)
    }

    fn set(&self, mode: u8) {
        self.mode.store(mode, Ordering::Release);
        for waker in self.wakers.lock().drain(..) {
            waker.wake();
        }
    }

    fn park(&self, cx: &Context<'_>) {
        let mut wakers = self.wakers.lock();
        if !wakers.iter().any(|waker| waker.will_wake(cx.waker())) {
            wakers.push(cx.waker().clone());
        }
    }
}

/// Il capo del client di un tubo, guastabile.
pub(crate) struct Tap {
    inner: DuplexStream,
    line: Arc<Line>,
}

impl AsyncRead for Tap {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.line.mode() {
            CUT => Poll::Ready(Err(io::ErrorKind::ConnectionReset.into())),
            SILENT => {
                self.line.park(cx);
                Poll::Pending
            }
            _ => {
                self.line.park(cx);
                Pin::new(&mut self.inner).poll_read(cx, buf)
            }
        }
    }
}

impl AsyncWrite for Tap {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.line.mode() {
            CUT => Poll::Ready(Err(io::ErrorKind::BrokenPipe.into())),
            // La rete muta inghiotte quello che il client manda.
            SILENT => Poll::Ready(Ok(buf.len())),
            _ => {
                self.line.park(cx);
                Pin::new(&mut self.inner).poll_write(cx, buf)
            }
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.line.mode() {
            CUT => Poll::Ready(Err(io::ErrorKind::BrokenPipe.into())),
            SILENT => Poll::Ready(Ok(())),
            _ => Pin::new(&mut self.inner).poll_flush(cx),
        }
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.line.mode() {
            CUT => Poll::Ready(Err(io::ErrorKind::BrokenPipe.into())),
            SILENT => Poll::Ready(Ok(())),
            _ => Pin::new(&mut self.inner).poll_shutdown(cx),
        }
    }
}

#[derive(Default)]
struct Control {
    down: AtomicBool,
    lines: Mutex<Vec<Arc<Line>>>,
}

/// Il lato del client: apre connessioni verso l'host in memoria.
#[derive(Clone)]
pub(crate) struct MemoryNet {
    incoming: mpsc::UnboundedSender<Box<dyn Io>>,
    control: Arc<Control>,
}

impl MemoryNet {
    pub(crate) fn new() -> (MemoryNet, mpsc::UnboundedReceiver<Box<dyn Io>>) {
        let (incoming, receiver) = mpsc::unbounded_channel();
        (
            MemoryNet {
                incoming,
                control: Arc::default(),
            },
            receiver,
        )
    }

    /// Una connessione nuova: l'altro capo va al listener dell'host.
    pub(crate) fn dial(&self) -> io::Result<Tap> {
        if self.control.down.load(Ordering::Acquire) {
            return Err(io::ErrorKind::ConnectionRefused.into());
        }
        let (client, server) = tokio::io::duplex(PIPE);
        // Se l'host è chiuso il capo del server cade, e il client legge la
        // fine del flusso: come una connessione rifiutata.
        let _ = self.incoming.send(Box::new(server));
        let line = Arc::new(Line {
            mode: AtomicU8::new(OPEN),
            wakers: Mutex::default(),
        });
        let mut lines = self.control.lines.lock();
        lines.retain(|line| Arc::strong_count(line) > 1);
        lines.push(line.clone());
        Ok(Tap {
            inner: client,
            line,
        })
    }

    /// Taglia ogni connessione aperta: il client legge un errore, e quando
    /// lascia cadere il suo capo l'host legge la fine del flusso.
    pub(crate) fn cut(&self) {
        for line in self.control.lines.lock().drain(..) {
            line.set(CUT);
        }
    }

    /// Rende mute le connessioni aperte: dal client non esce più niente e non
    /// entra più niente, ma nessuno dei due lati vede la caduta.
    pub(crate) fn silence(&self) {
        for line in self.control.lines.lock().iter() {
            line.set(SILENT);
        }
    }

    /// Rifiuta, o accetta di nuovo, le connessioni nuove.
    pub(crate) fn set_down(&self, down: bool) {
        self.control.down.store(down, Ordering::Release);
    }
}
