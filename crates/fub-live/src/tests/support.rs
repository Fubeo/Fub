//! Gli attrezzi delle prove: una sessione in memoria, la coda degli eventi
//! letta uno alla volta, e uno scrittore grezzo che manda quello che gli si
//! dice, anche fuori dal protocollo.

use std::collections::VecDeque;
use std::net::Ipv4Addr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::AsyncWriteExt;
use tokio::time::timeout;
use tokio_rustls::TlsConnector;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{header, HeaderValue};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{client_async_with_config, WebSocketStream};
use zeroize::Zeroizing;

use super::net::{MemoryNet, Tap};
use crate::counter::Counter;
use crate::host::{LiveConfig, LiveEvent, LiveEvents, LiveHost};
use crate::net::ListenAddr;
use crate::pairing::PairingTarget;
use crate::protocol::{
    Caps, Commit, Credential, Device, DocumentInfo, Hello, HostMessage, Ops, Ping, Snapshot,
    StrokeId, Welcome, WriterMessage,
};
use crate::tls::{client_config, server_name, websocket_config};
use crate::token::ResumeToken;

/// L'indirizzo delle sessioni in memoria: privato, e nessuno lo lega davvero.
pub(crate) const IP: Ipv4Addr = Ipv4Addr::new(192, 168, 1, 20);

/// Lo snapshot iniziale delle prove.
pub(crate) const SNAPSHOT: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" fub:version="1"/>"#;

/// Il contatore dello snapshot iniziale.
pub(crate) const SEQ: Counter = Counter(7);

/// L'attesa oltre la quale una prova è bloccata: con il tempo in pausa
/// l'orologio salta da una scadenza all'altra, e un'ora basta a ogni caso.
const STUCK: Duration = Duration::from_secs(3600);

pub(crate) fn document() -> DocumentInfo {
    DocumentInfo {
        id: "doc-1".into(),
        title: "Schizzo".into(),
    }
}

pub(crate) fn config() -> LiveConfig {
    LiveConfig {
        listen: ListenAddr::new(IP).unwrap(),
        port: 0,
        host_name: Some("Studio di Ada".into()),
        document: document(),
        snapshot: Snapshot {
            seq: SEQ,
            text: SNAPSHOT.into(),
        },
    }
}

pub(crate) fn device() -> Device {
    Device {
        name: "Tablet di Ada".into(),
        kind: "tablet".into(),
    }
}

pub(crate) fn caps() -> Caps {
    Caps {
        pressure: true,
        tilt: false,
        coalesced: true,
        predicted: false,
    }
}

pub(crate) fn stroke(text: &str) -> StrokeId {
    StrokeId::parse(text).unwrap()
}

/// Un'operazione `add` con l'id indicato.
pub(crate) fn ops(id: &str) -> Ops {
    Ops::parse(
        &format!(r#"[{{"op":"add","parent":"l1","elem":{{"tag":"path","id":"{id}"}}}}]"#),
        10,
    )
    .unwrap()
}

/// Operazioni che pesano circa `bytes` byte.
pub(crate) fn heavy_ops(bytes: usize) -> Ops {
    Ops::parse(
        &format!(r#"[{{"op":"set","id":"o1","x":"{}"}}]"#, "a".repeat(bytes)),
        10,
    )
    .unwrap()
}

/// Una sessione in memoria, con il QR già letto.
pub(crate) struct Live {
    pub(crate) host: LiveHost,
    pub(crate) events: Events,
    pub(crate) net: MemoryNet,
    pub(crate) target: PairingTarget,
}

pub(crate) fn start() -> Live {
    start_with(config())
}

pub(crate) fn start_with(config: LiveConfig) -> Live {
    let (host, events, net) = LiveHost::start_in_memory(config).unwrap();
    let target = PairingTarget::parse(&host.pairing().unwrap().payload).unwrap();
    Live {
        host,
        events: Events::new(events),
        net,
        target,
    }
}

/// Un QR nuovo, quando nessuno scrittore è collegato.
pub(crate) fn renew(live: &Live) -> PairingTarget {
    PairingTarget::parse(&live.host.renew_pairing().unwrap().payload).unwrap()
}

/// Gli eventi della shell, uno alla volta.
pub(crate) struct Events {
    inner: LiveEvents,
    queue: VecDeque<LiveEvent>,
}

impl Events {
    pub(crate) fn new(inner: LiveEvents) -> Events {
        Events {
            inner,
            queue: VecDeque::new(),
        }
    }

    /// Il prossimo evento; `None` dopo la fine.
    pub(crate) async fn next(&mut self) -> Option<LiveEvent> {
        loop {
            if let Some(event) = self.queue.pop_front() {
                return Some(event);
            }
            let batch = timeout(STUCK, self.inner.recv())
                .await
                .expect("no event within an hour")?;
            self.queue.extend(batch);
        }
    }

    /// Il prossimo evento che `pick` riconosce, saltando gli altri.
    pub(crate) async fn find<T>(&mut self, mut pick: impl FnMut(LiveEvent) -> Option<T>) -> T {
        loop {
            let event = self
                .next()
                .await
                .expect("the events ended before the expected one");
            if let Some(found) = pick(event) {
                return found;
            }
        }
    }

    /// Gli eventi già arrivati, senza aspettare.
    pub(crate) fn ready(&mut self) -> Vec<LiveEvent> {
        let mut events: Vec<LiveEvent> = self.queue.drain(..).collect();
        events.extend(self.inner.try_recv());
        events
    }
}

/// Come l'host ha chiuso con lo scrittore grezzo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Closed {
    /// Il codice del frame di chiusura; `None` se il trasporto è caduto senza.
    pub(crate) code: Option<u16>,
    /// Il codice del messaggio `error`, se c'era.
    pub(crate) error: Option<u16>,
    /// Il motivo del `bye` o il dettaglio dell'`error`.
    pub(crate) detail: Option<String>,
}

/// Uno scrittore senza le buone maniere del client.
pub(crate) struct Raw {
    pub(crate) ws: WebSocketStream<tokio_rustls::client::TlsStream<Tap>>,
}

impl Raw {
    /// TLS e upgrade, senza `hello`.
    pub(crate) async fn open(net: &MemoryNet, target: &PairingTarget) -> Raw {
        Raw::try_open(net, target, "/live", None).await.unwrap()
    }

    pub(crate) async fn try_open(
        net: &MemoryNet,
        target: &PairingTarget,
        path: &str,
        origin: Option<&str>,
    ) -> Result<Raw, WsError> {
        let io = net.dial()?;
        let tls = TlsConnector::from(client_config(target.fingerprint).unwrap())
            .connect(server_name(*target.addr.ip()), io)
            .await?;
        let mut request = format!("wss://{}{path}", target.addr).into_client_request()?;
        if let Some(origin) = origin {
            request
                .headers_mut()
                .insert(header::ORIGIN, HeaderValue::from_str(origin).unwrap());
        }
        let (ws, _) = client_async_with_config(request, tls, Some(websocket_config())).await?;
        Ok(Raw { ws })
    }

    /// Un frame di testo; `false` se la connessione è già chiusa.
    pub(crate) async fn text(&mut self, text: impl Into<String>) -> bool {
        self.ws
            .send(Message::Text(text.into().into()))
            .await
            .is_ok()
    }

    pub(crate) async fn send(&mut self, message: &WriterMessage) -> bool {
        self.text(message.to_json()).await
    }

    /// Byte scritti sotto il WebSocket, per i frame che `tungstenite` non
    /// manderebbe mai.
    pub(crate) async fn bytes(&mut self, bytes: &[u8]) {
        let stream = self.ws.get_mut();
        stream.write_all(bytes).await.unwrap();
        stream.flush().await.unwrap();
    }

    pub(crate) async fn hello(&mut self, target: &PairingTarget) {
        let secret = Credential::Secret(Zeroizing::new(target.secret.encode()));
        assert!(self.send(&hello(target, secret)).await);
    }

    pub(crate) async fn resume(&mut self, target: &PairingTarget, token: &ResumeToken) {
        let resume = Credential::Resume(Zeroizing::new(token.encode()));
        assert!(self.send(&hello(target, resume)).await);
    }

    pub(crate) async fn ping(&mut self, id: u64) -> bool {
        self.send(&WriterMessage::Ping(Ping {
            id,
            a: 1000.0 + id as f64,
        }))
        .await
    }

    pub(crate) async fn commit(&mut self, c: u64, ops: Ops) -> bool {
        self.send(&WriterMessage::Commit(Commit { c: Counter(c), ops }))
            .await
    }

    /// Il prossimo messaggio dell'host, saltando i frame di controllo; `None`
    /// alla chiusura.
    pub(crate) async fn recv(&mut self) -> Option<HostMessage> {
        loop {
            let frame = timeout(STUCK, self.ws.next())
                .await
                .expect("no frame within an hour");
            match frame {
                Some(Ok(Message::Text(text))) => return Some(HostMessage::parse(&text).unwrap()),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return None,
                Some(Ok(_)) => {}
            }
        }
    }

    /// Il `welcome`, e lo snapshot che lo segue.
    pub(crate) async fn welcome(&mut self) -> (Welcome, Snapshot) {
        let welcome = match self.recv().await {
            Some(HostMessage::Welcome(welcome)) => welcome,
            other => panic!("expected a welcome, got {other:?}"),
        };
        let snapshot = match self.recv().await {
            Some(HostMessage::Snapshot(snapshot)) => snapshot,
            other => panic!("expected a snapshot, got {other:?}"),
        };
        (welcome, snapshot)
    }

    /// Legge fino alla chiusura e dice come è avvenuta.
    pub(crate) async fn closed(&mut self) -> Closed {
        let mut closed = Closed {
            code: None,
            error: None,
            detail: None,
        };
        loop {
            let frame = timeout(STUCK, self.ws.next())
                .await
                .expect("no close within an hour");
            match frame {
                Some(Ok(Message::Text(text))) => match HostMessage::parse(&text).unwrap() {
                    HostMessage::Error(error) => {
                        closed.error = Some(error.code);
                        closed.detail = Some(error.detail);
                    }
                    HostMessage::Bye(bye) => closed.detail = Some(bye.reason),
                    _ => {}
                },
                Some(Ok(Message::Close(frame))) => {
                    closed.code = frame.map(|frame| u16::from(frame.code));
                    // La risposta alla chiusura, poi la fine del flusso.
                    let _ = self.ws.flush().await;
                    while let Ok(Some(Ok(_))) = timeout(STUCK, self.ws.next()).await {}
                    return closed;
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => return closed,
            }
        }
    }

    /// Il codice con cui l'host chiude, controllando che `error` e il frame
    /// di chiusura dicano lo stesso.
    pub(crate) async fn close_code(&mut self) -> u16 {
        let closed = self.closed().await;
        let code = closed.code.expect("the host closed without a close frame");
        if let Some(error) = closed.error {
            assert_eq!(error, code, "{closed:?}");
        }
        code
    }
}

/// Un `hello` con la credenziale indicata.
pub(crate) fn hello(target: &PairingTarget, credential: Credential) -> WriterMessage {
    WriterMessage::Hello(Hello {
        session: target.session.encode(),
        credential,
        device: device(),
        caps: caps(),
    })
}

/// Lo scrittore grezzo entrato con il segreto.
pub(crate) async fn join(net: &MemoryNet, target: &PairingTarget) -> (Raw, Welcome) {
    let mut raw = Raw::open(net, target).await;
    raw.hello(target).await;
    let (welcome, snapshot) = raw.welcome().await;
    assert_eq!(snapshot.text, SNAPSHOT);
    (raw, welcome)
}

/// Lo scrittore grezzo rientrato con il gettone.
pub(crate) async fn rejoin(
    net: &MemoryNet,
    target: &PairingTarget,
    token: &ResumeToken,
) -> (Raw, Welcome) {
    let mut raw = Raw::open(net, target).await;
    raw.resume(target, token).await;
    let welcome = match raw.recv().await {
        Some(HostMessage::Welcome(welcome)) => welcome,
        other => panic!("expected a welcome, got {other:?}"),
    };
    (raw, welcome)
}

/// Un frame WebSocket mascherato come quelli di un client, con l'opcode e il
/// primo byte indicati.
pub(crate) fn frame(first: u8, payload: &[u8]) -> Vec<u8> {
    let mask = [0x37, 0xfa, 0x21, 0x3d];
    let mut bytes = vec![first];
    match payload.len() {
        len @ 0..=125 => bytes.push(0x80 | len as u8),
        len @ 126..=0xffff => {
            bytes.push(0x80 | 126);
            bytes.extend_from_slice(&(len as u16).to_be_bytes());
        }
        len => {
            bytes.push(0x80 | 127);
            bytes.extend_from_slice(&(len as u64).to_be_bytes());
        }
    }
    bytes.extend_from_slice(&mask);
    bytes.extend(
        payload
            .iter()
            .enumerate()
            .map(|(index, byte)| byte ^ mask[index % 4]),
    );
    bytes
}
