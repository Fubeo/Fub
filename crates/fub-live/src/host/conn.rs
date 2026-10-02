//! Una connessione, dal socket accettato alla chiusura.
//!
//! Prima del `welcome` la connessione costa poco e per poco: una scadenza
//! assoluta di 5 secondi dall'accettazione copre TLS, upgrade e `hello`, e
//! al più 64 KiB letti. Dopo, un compito solo legge e scrive: chi legge
//! conta i messaggi al secondo e passa alla sessione, chi scrive svuota la
//! coda della connessione e manda gli heartbeat. La prima parte che finisce
//! decide come si chiude.
//!
//! Comunque finisca il compito, anche con un panic o interrotto dalla
//! chiusura della sessione, una guardia avvisa la sessione con l'id della
//! connessione.

use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::sync::OwnedSemaphorePermit;
use tokio::time::{interval_at, timeout, timeout_at, Instant, MissedTickBehavior};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{header, StatusCode};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode as WireCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::{Bytes, Error as WsError, Message, Utf8Bytes};
use tokio_tungstenite::{accept_hdr_async_with_config, WebSocketStream};

use super::events::LeaveReason;
use super::outbox::{CloseRequest, Next, Outbox};
use super::session::ConnId;
use super::{Alive, Shared};
use crate::limits::{
    CLOSE_GRACE, HEARTBEAT, HEARTBEAT_MISSES, HELLO_BUDGET, HELLO_TIMEOUT, RATE_PER_SECOND,
    WRITE_TIMEOUT,
};
use crate::protocol::{
    parse_hello, parse_writer, truncate, ByeMessage, CloseCode, ErrorMessage, HostMessage, Parsed,
    Violation, WriterMessage,
};
use crate::rate::RateWindow;
use crate::tls::websocket_config;

/// Un trasporto: il socket TCP, o nelle prove un tubo in memoria.
pub(crate) trait Io: AsyncRead + AsyncWrite + Unpin + Send + 'static {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send + 'static> Io for T {}

/// Il budget illimitato.
const UNLIMITED: usize = usize::MAX;

/// Un trasporto che smette di leggere oltre un budget di byte, finché il
/// budget non si toglie. Sta sotto TLS: conta anche il handshake.
struct Budget<S> {
    inner: S,
    remaining: Arc<AtomicUsize>,
}

/// L'errore di lettura oltre il budget.
#[derive(Debug, thiserror::Error)]
#[error("the connection read more than {HELLO_BUDGET} bytes before its hello")]
struct OverBudget;

impl<S: AsyncRead + Unpin> AsyncRead for Budget<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let remaining = self.remaining.load(Ordering::Acquire);
        if remaining == 0 {
            return Poll::Ready(Err(io::Error::other(OverBudget)));
        }
        let before = buf.filled().len();
        let polled = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = polled {
            if remaining != UNLIMITED {
                let read = buf.filled().len() - before;
                // Una lettura può superare il budget di quanto chiede il
                // buffer: il superamento è limitato, e la lettura dopo fallisce.
                self.remaining
                    .store(remaining.saturating_sub(read), Ordering::Release);
            }
        }
        polled
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Budget<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

fn over_budget(error: &io::Error) -> bool {
    error
        .get_ref()
        .is_some_and(|inner| inner.is::<OverBudget>())
}

type Ws = WebSocketStream<tokio_rustls::server::TlsStream<Budget<Box<dyn Io>>>>;

/// Come finisce una connessione ammessa.
enum End {
    /// L'host chiude con questo codice (sessione finita, ripresa altrove,
    /// coda piena).
    Kick(CloseRequest),
    /// Lo scrittore ha violato il protocollo.
    Violation(Violation),
    /// Lo scrittore ha salutato.
    WriterBye,
    /// Lo scrittore ha mandato la chiusura senza `bye`.
    PeerClosed,
    /// Il trasporto è caduto, o una scrittura non è finita in tempo.
    Lost(LeaveReason),
}

impl End {
    fn reason(&self) -> LeaveReason {
        match self {
            End::Kick(request) => request.reason,
            End::Violation(violation) if violation.code == CloseCode::TooMuchTraffic => {
                LeaveReason::TooMuchTraffic
            }
            End::Violation(violation) => LeaveReason::Violation {
                code: violation.code.code(),
            },
            End::WriterBye => LeaveReason::WriterBye,
            End::PeerClosed => LeaveReason::Lost,
            End::Lost(reason) => *reason,
        }
    }
}

/// Avvisa la sessione della fine della connessione, una volta sola, anche se
/// il compito finisce con un panic o viene interrotto.
struct Closing<'a> {
    shared: &'a Shared,
    conn: ConnId,
    reason: Option<LeaveReason>,
}

impl Closing<'_> {
    fn fire(&mut self, reason: LeaveReason) {
        if self.reason.take().is_some() {
            self.shared
                .session
                .lock()
                .closed(self.conn, reason, Instant::now());
            self.shared.wake.notify_one();
        }
    }
}

impl Drop for Closing<'_> {
    fn drop(&mut self) {
        if let Some(reason) = self.reason {
            self.fire(reason);
        }
    }
}

/// L'heartbeat della connessione, condiviso fra chi legge e chi scrive.
#[derive(Default)]
struct Heartbeat {
    next: u64,
    waiting: Option<(u64, Instant)>,
    missed: u32,
}

impl Heartbeat {
    /// Un battito: `None` se gli ultimi due sono rimasti senza risposta.
    fn beat(&mut self, now: Instant) -> Option<Bytes> {
        if self.waiting.is_some() {
            self.missed += 1;
        }
        if self.missed >= HEARTBEAT_MISSES {
            return None;
        }
        self.next += 1;
        self.waiting = Some((self.next, now));
        Some(Bytes::copy_from_slice(&self.next.to_be_bytes()))
    }

    /// Un `pong`: il giro, se risponde all'ultimo battito.
    fn pong(&mut self, payload: &[u8], now: Instant) -> Option<Duration> {
        let id = u64::from_be_bytes(payload.try_into().ok()?);
        if id == 0 || id > self.next {
            // Un `pong` non chiesto (RFC 6455 lo ammette) non prova niente.
            return None;
        }
        self.missed = 0;
        match self.waiting {
            Some((waiting, sent)) if waiting == id => {
                self.waiting = None;
                Some(now.saturating_duration_since(sent))
            }
            _ => None,
        }
    }
}

/// Serve una connessione accettata.
pub(crate) async fn serve(
    shared: Arc<Shared>,
    io: Box<dyn Io>,
    conn: ConnId,
    permit: OwnedSemaphorePermit,
) {
    let _alive = Alive::new(&shared.tasks);
    let deadline = Instant::now() + HELLO_TIMEOUT;
    let remaining = Arc::new(AtomicUsize::new(HELLO_BUDGET));
    let stream = Budget {
        inner: io,
        remaining: remaining.clone(),
    };

    let Some(mut ws) = upgrade(&shared, stream, deadline).await else {
        shared.session.lock().rejected();
        return;
    };
    let mut rate = RateWindow::new(RATE_PER_SECOND, Duration::from_secs(1));
    let outbox = Arc::new(Outbox::new());
    let admitted = match hello(&mut ws, &mut rate, deadline).await {
        Ok(hello) => {
            let admitted =
                shared
                    .session
                    .lock()
                    .admit(hello, conn, &outbox, &shared.rng, Instant::now());
            shared.wake.notify_one();
            admitted
        }
        Err(None) => {
            shared.session.lock().rejected();
            return;
        }
        Err(Some(violation)) => Err(violation),
    };
    if let Err(violation) = admitted {
        shared.session.lock().rejected();
        close(
            &mut ws,
            violation.code,
            &violation.detail,
            Instant::now() + CLOSE_GRACE,
        )
        .await;
        return;
    }
    // Ammessa: il budget e il posto fra le connessioni che negoziano non
    // servono più.
    remaining.store(UNLIMITED, Ordering::Release);
    drop(permit);

    let mut closing = Closing {
        shared: &shared,
        conn,
        reason: Some(LeaveReason::Lost),
    };
    let end = run(&shared, &mut ws, conn, &outbox, &mut rate).await;
    closing.fire(end.reason());
    drop(closing);
    finish(&mut ws, end).await;
}

/// TLS e upgrade WebSocket, entro la scadenza del `hello`.
async fn upgrade(shared: &Shared, stream: Budget<Box<dyn Io>>, deadline: Instant) -> Option<Ws> {
    let tls = timeout_at(deadline, shared.acceptor.accept(stream))
        .await
        .ok()?
        .ok()?;
    let origin = shared.origin.clone();
    let callback = move |request: &Request, response: Response| match refusal(request, &origin) {
        None => Ok(response),
        Some(status) => {
            let mut refusal = ErrorResponse::new(None);
            *refusal.status_mut() = status;
            Err(refusal)
        }
    };
    timeout_at(
        deadline,
        accept_hdr_async_with_config(tls, callback, Some(websocket_config())),
    )
    .await
    .ok()?
    .ok()
}

/// Lo stato con cui si rifiuta la richiesta di upgrade, `None` se passa: il
/// percorso `/live`, e nessuna origine salvo quella dell'host. Un client in
/// Rust non manda `Origin`; un browser sì, e una pagina di un altro sito non
/// deve poter aprire la sessione.
fn refusal(request: &Request, origin: &str) -> Option<StatusCode> {
    if request.uri().path() != "/live" || request.uri().query().is_some() {
        return Some(StatusCode::NOT_FOUND);
    }
    let origins = request.headers().get_all(header::ORIGIN);
    origins
        .iter()
        .any(|value| value.as_bytes() != origin.as_bytes())
        .then_some(StatusCode::FORBIDDEN)
}

/// Il codice della violazione che un errore del WebSocket rappresenta; `None`
/// se il trasporto è semplicemente caduto.
fn transport_violation(error: &WsError) -> Option<Violation> {
    match error {
        WsError::Capacity(_) => Some(Violation::new(
            CloseCode::MessageTooBig,
            "the message exceeds 24 MiB",
        )),
        WsError::Utf8(_) => Some(Violation::new(
            CloseCode::InvalidPayload,
            "a text frame is not UTF-8",
        )),
        WsError::Protocol(error) => Some(Violation::new(
            CloseCode::ProtocolError,
            format!("WebSocket protocol error: {error}"),
        )),
        _ => None,
    }
}

/// Aspetta il `hello`. `Err(None)`: la connessione è caduta o ha chiuso.
async fn hello(
    ws: &mut Ws,
    rate: &mut RateWindow,
    deadline: Instant,
) -> Result<crate::protocol::Hello, Option<Violation>> {
    loop {
        let message = match timeout_at(deadline, ws.next()).await {
            Err(_) => {
                return Err(Some(Violation::new(
                    CloseCode::InvalidHello,
                    "no hello within 5 seconds",
                )))
            }
            Ok(None) => return Err(None),
            Ok(Some(Err(WsError::Io(error)))) if over_budget(&error) => {
                return Err(Some(Violation::new(
                    CloseCode::InvalidHello,
                    "the hello exceeds the limits",
                )))
            }
            Ok(Some(Err(error))) => return Err(transport_violation(&error)),
            Ok(Some(Ok(message))) => message,
        };
        if !rate.admit(Instant::now()) {
            return Err(Some(Violation::new(
                CloseCode::TooMuchTraffic,
                "more than 240 messages in a second",
            )));
        }
        match message {
            Message::Text(text) => return parse_hello(&text).map_err(Some),
            Message::Binary(_) => {
                return Err(Some(Violation::new(
                    CloseCode::UnsupportedData,
                    "binary frames are not part of the protocol",
                )))
            }
            Message::Close(_) => return Err(None),
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}

/// La connessione ammessa: legge e scrive finché una delle due parti finisce.
async fn run(
    shared: &Shared,
    ws: &mut Ws,
    conn: ConnId,
    outbox: &Outbox,
    rate: &mut RateWindow,
) -> End {
    let heartbeat = Mutex::new(Heartbeat::default());
    let (mut sink, mut stream) = ws.split();

    let reader = async {
        loop {
            let message = match stream.next().await {
                None => return End::Lost(LeaveReason::Lost),
                Some(Err(error)) => {
                    return match transport_violation(&error) {
                        Some(violation) => End::Violation(violation),
                        None => End::Lost(LeaveReason::Lost),
                    }
                }
                Some(Ok(message)) => message,
            };
            let now = Instant::now();
            if !rate.admit(now) {
                return End::Violation(Violation::new(
                    CloseCode::TooMuchTraffic,
                    "more than 240 messages in a second",
                ));
            }
            let outcome = match message {
                Message::Text(text) => match parse_writer(&text) {
                    Err(violation) => Err(violation),
                    Ok(Parsed::Message(WriterMessage::Bye)) => return End::WriterBye,
                    Ok(Parsed::Message(message)) => shared.session.lock().inbound(conn, message),
                    Ok(Parsed::CommitOverLimit { c, detail }) => {
                        shared.session.lock().commit_over_limit(conn, c, detail)
                    }
                },
                Message::Binary(_) => Err(Violation::new(
                    CloseCode::UnsupportedData,
                    "binary frames are not part of the protocol",
                )),
                Message::Pong(payload) => {
                    let rtt = heartbeat.lock().pong(&payload, now);
                    if let Some(rtt) = rtt {
                        shared.session.lock().heartbeat(conn, rtt);
                    }
                    Ok(())
                }
                Message::Close(_) => return End::PeerClosed,
                // Al `ping` risponde `tungstenite` da sé.
                Message::Ping(_) | Message::Frame(_) => Ok(()),
            };
            if let Err(violation) = outcome {
                return End::Violation(violation);
            }
        }
    };

    let writer = async {
        let mut ticker = interval_at(Instant::now() + HEARTBEAT, HEARTBEAT);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            let message = match outbox.next() {
                Next::Send(text) => Message::Text(text),
                Next::Close(request) => return End::Kick(request),
                Next::Wait => {
                    tokio::select! {
                        () = outbox.changed() => continue,
                        _ = ticker.tick() => {
                            let beat = heartbeat.lock().beat(Instant::now());
                            match beat {
                                Some(payload) => Message::Ping(payload),
                                None => return End::Lost(LeaveReason::Heartbeat),
                            }
                        }
                    }
                }
            };
            match timeout(WRITE_TIMEOUT, sink.send(message)).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => return End::Lost(LeaveReason::Lost),
                // Lo scrittore non legge: la connessione è troppo lenta per
                // la sessione.
                Err(_) => return End::Lost(LeaveReason::Congested),
            }
        }
    };

    tokio::select! {
        end = reader => end,
        end = writer => end,
    }
}

/// Chiude secondo come è finita.
async fn finish(ws: &mut Ws, end: End) {
    let grace = Instant::now() + CLOSE_GRACE;
    match end {
        End::Kick(request) => close(ws, request.code, &request.detail, grace).await,
        End::Violation(violation) => close(ws, violation.code, &violation.detail, grace).await,
        End::WriterBye => close(ws, CloseCode::Normal, "bye", grace).await,
        End::PeerClosed => {
            // `tungstenite` ha già accodato la risposta alla chiusura: si
            // manda e si aspetta la fine.
            let _ = timeout_at(grace, ws.flush()).await;
            drain(ws, grace).await;
            shutdown(ws, grace).await;
        }
        // Un trasporto caduto o muto non risponderebbe a una chiusura.
        End::Lost(_) => {}
    }
}

/// Manda il motivo e la chiusura, poi aspetta quella dello scrittore entro la
/// scadenza. Con 1000 e 1001 il motivo è un `bye`; con gli altri codici un
/// `error`.
async fn close(ws: &mut Ws, code: CloseCode, detail: &str, grace: Instant) {
    let notice = match code {
        CloseCode::Normal | CloseCode::HostClosing => HostMessage::Bye(ByeMessage {
            reason: detail.to_owned(),
        }),
        _ => HostMessage::Error(ErrorMessage {
            code: code.code(),
            detail: detail.to_owned(),
        }),
    };
    let frame = CloseFrame {
        code: WireCode::from(code.code()),
        // Il motivo di una chiusura sta in 123 byte.
        reason: Utf8Bytes::from(truncate(detail, 123)),
    };
    let sent = timeout_at(grace, async {
        ws.send(Message::Text(notice.to_json().into())).await?;
        ws.send(Message::Close(Some(frame))).await
    })
    .await;
    if matches!(sent, Ok(Ok(()))) {
        drain(ws, grace).await;
    }
    shutdown(ws, grace).await;
}

/// Legge e scarta fino alla chiusura dello scrittore.
async fn drain(ws: &mut Ws, grace: Instant) {
    let _ = timeout_at(grace, async { while let Some(Ok(_)) = ws.next().await {} }).await;
}

/// Chiude TLS e TCP.
async fn shutdown(ws: &mut Ws, grace: Instant) {
    let _ = timeout_at(grace, ws.get_mut().shutdown()).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn the_budget_stops_reads_until_it_is_lifted() {
        let (mut near, far) = tokio::io::duplex(1024);
        let remaining = Arc::new(AtomicUsize::new(8));
        let mut budget = Budget {
            inner: far,
            remaining: remaining.clone(),
        };
        near.write_all(&[1; 16]).await.unwrap();
        let mut buf = [0u8; 4];
        budget.read_exact(&mut buf).await.unwrap();
        budget.read_exact(&mut buf).await.unwrap();
        let error = budget.read_exact(&mut buf).await.unwrap_err();
        assert!(over_budget(&error));
        remaining.store(UNLIMITED, Ordering::Release);
        budget.read_exact(&mut buf).await.unwrap();
    }

    #[test]
    fn a_heartbeat_without_pongs_stops_at_the_second_miss() {
        let start = Instant::now();
        let mut heartbeat = Heartbeat::default();
        let first = heartbeat.beat(start).unwrap();
        let rtt = heartbeat.pong(&first, start + Duration::from_millis(30));
        assert_eq!(rtt, Some(Duration::from_millis(30)));
        assert!(heartbeat.beat(start).is_some());
        assert!(heartbeat.beat(start).is_some());
        assert!(heartbeat.beat(start).is_none());
        // Un `pong` non chiesto non conta.
        let mut other = Heartbeat::default();
        other.beat(start);
        assert_eq!(other.pong(&99u64.to_be_bytes(), start), None);
        assert_eq!(other.pong(b"short", start), None);
        assert!(other.beat(start).is_some());
        assert!(other.beat(start).is_none());
    }

    #[test]
    fn the_upgrade_accepts_only_the_live_path_and_the_host_origin() {
        let origin = "https://192.168.1.2:4000";
        let request = |path: &str, origins: &[&str]| {
            let mut builder = Request::builder().uri(path);
            for value in origins {
                builder = builder.header(header::ORIGIN, *value);
            }
            builder.body(()).unwrap()
        };
        let status =
            |request: Request| refusal(&request, origin).unwrap_or(StatusCode::SWITCHING_PROTOCOLS);
        assert_eq!(
            status(request("/live", &[])),
            StatusCode::SWITCHING_PROTOCOLS
        );
        assert_eq!(
            status(request("/live", &[origin])),
            StatusCode::SWITCHING_PROTOCOLS
        );
        assert_eq!(status(request("/", &[])), StatusCode::NOT_FOUND);
        assert_eq!(status(request("/live?x=1", &[])), StatusCode::NOT_FOUND);
        assert_eq!(status(request("/live/", &[])), StatusCode::NOT_FOUND);
        assert_eq!(
            status(request("/live", &["https://evil.example"])),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            status(request("/live", &[origin, "null"])),
            StatusCode::FORBIDDEN
        );
    }
}
