//! I tipi che la shell scambia con l'host: ciò che manda allo scrittore, lo
//! stato che legge, il QR che mostra.
//!
//! Tutti hanno una forma JSON con i nomi in camelCase e gli `u64` come
//! stringhe decimali, perché l'adattatore di Tauri (FD-303) li passa così come
//! sono alla shell e ne genera le fixture del mirror TypeScript.

use std::borrow::Cow;
use std::fmt;
use std::net::SocketAddrV4;

use serde::de::{self, MapAccess, Visitor};
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use zeroize::Zeroizing;

use crate::clock::ClockEstimate;
use crate::counter::{decimal, Counter, WriterId};
use crate::protocol::{Caps, Device, NackReason, Ops};
use crate::token::{Fingerprint, SessionId};

/// Un messaggio della shell verso lo scrittore. In JSON ha il tipo in `t`.
///
/// La shell risponde a ogni [`LiveEvent::Commit`](super::LiveEvent::Commit)
/// con `ack` o `nack`, nominando lo scrittore e il contatore del commit; manda
/// `ops` per le operazioni nate sul PC e `snapshot` per i cambiamenti che non
/// sono operazioni («L'host e la shell» in `docs/reference/live-session.md`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ShellMessage {
    /// Un commit applicato.
    Ack {
        /// Lo scrittore del commit.
        writer: WriterId,
        /// Il contatore del commit.
        c: Counter,
        /// Il contatore del documento dopo il commit.
        seq: Counter,
        /// Le operazioni applicate, in forma canonica.
        echo: Ops,
        /// Il commit era già applicato e identico.
        duplicate: bool,
    },
    /// Un commit rifiutato.
    Nack {
        /// Lo scrittore del commit.
        writer: WriterId,
        /// Il contatore del commit.
        c: Counter,
        /// Il motivo, quello del motore delle operazioni.
        reason: NackReason,
        /// Il dettaglio leggibile.
        detail: String,
        /// L'indice dell'operazione rifiutata.
        index: Option<u32>,
    },
    /// Operazioni nate sul PC.
    Ops {
        /// Il contatore del documento dopo le operazioni.
        seq: Counter,
        /// Le operazioni, in forma canonica.
        ops: Ops,
    },
    /// Il documento intero, dopo un cambiamento che non è un'operazione.
    Snapshot {
        /// Il contatore del documento.
        seq: Counter,
        /// Il testo SVG.
        text: String,
    },
}

/// I campi di [`ShellMessage`], nell'ordine dei bit di `Fields::present`.
const SHELL_FIELDS: &[&str] = &[
    "t",
    "writer",
    "c",
    "seq",
    "echo",
    "duplicate",
    "reason",
    "detail",
    "index",
    "ops",
    "text",
];

#[derive(Default)]
struct Fields {
    present: u16,
    t: Option<String>,
    writer: Option<WriterId>,
    c: Option<Counter>,
    seq: Option<Counter>,
    echo: Option<Ops>,
    duplicate: Option<bool>,
    reason: Option<NackReason>,
    detail: Option<String>,
    index: Option<Option<u32>>,
    ops: Option<Ops>,
    text: Option<String>,
}

/// La lettura è stretta come quella dei messaggi dello scrittore: i campi del
/// tipo e nessun altro, ognuno una volta. Non è derivata perché la derivazione
/// di un enum con il tipo in `t` passa per una copia intermedia del messaggio
/// in cui le operazioni opache non si leggono, e perché la shell le manda
/// anche come `serde_json::Value` (l'IPC di Tauri), dove lo stesso testo deve
/// valere uguale.
impl<'de> Deserialize<'de> for ShellMessage {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(ShellVisitor)
    }
}

struct ShellVisitor;

impl<'de> Visitor<'de> for ShellVisitor {
    type Value = ShellMessage;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a shell message object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<ShellMessage, A::Error> {
        let mut fields = Fields::default();
        while let Some(key) = map.next_key::<Cow<'de, str>>()? {
            let bit = SHELL_FIELDS
                .iter()
                .position(|name| *name == key)
                .ok_or_else(|| de::Error::unknown_field(&key, SHELL_FIELDS))?;
            if fields.present & (1 << bit) != 0 {
                return Err(de::Error::duplicate_field(SHELL_FIELDS[bit]));
            }
            fields.present |= 1 << bit;
            match SHELL_FIELDS[bit] {
                "t" => fields.t = Some(map.next_value()?),
                "writer" => fields.writer = Some(map.next_value()?),
                "c" => fields.c = Some(map.next_value()?),
                "seq" => fields.seq = Some(map.next_value()?),
                "echo" => fields.echo = Some(map.next_value()?),
                "duplicate" => fields.duplicate = Some(map.next_value()?),
                "reason" => fields.reason = Some(map.next_value()?),
                "detail" => fields.detail = Some(map.next_value()?),
                "index" => fields.index = Some(map.next_value()?),
                "ops" => fields.ops = Some(map.next_value()?),
                _ => fields.text = Some(map.next_value()?),
            }
        }
        fields.build()
    }
}

impl Fields {
    fn build<E: de::Error>(self) -> Result<ShellMessage, E> {
        let t = self.t.ok_or_else(|| de::Error::missing_field("t"))?;
        let allowed: &[&str] = match t.as_str() {
            "ack" => &["t", "writer", "c", "seq", "echo", "duplicate"],
            "nack" => &["t", "writer", "c", "reason", "detail", "index"],
            "ops" => &["t", "seq", "ops"],
            "snapshot" => &["t", "seq", "text"],
            _ => {
                return Err(de::Error::unknown_variant(
                    &t,
                    &["ack", "nack", "ops", "snapshot"],
                ))
            }
        };
        for (bit, name) in SHELL_FIELDS.iter().enumerate() {
            if self.present & (1 << bit) != 0 && !allowed.contains(name) {
                return Err(de::Error::unknown_field(name, allowed));
            }
        }
        fn need<T, E: de::Error>(value: Option<T>, name: &'static str) -> Result<T, E> {
            value.ok_or_else(|| de::Error::missing_field(name))
        }
        Ok(match t.as_str() {
            "ack" => ShellMessage::Ack {
                writer: need(self.writer, "writer")?,
                c: need(self.c, "c")?,
                seq: need(self.seq, "seq")?,
                echo: need(self.echo, "echo")?,
                duplicate: need(self.duplicate, "duplicate")?,
            },
            "nack" => ShellMessage::Nack {
                writer: need(self.writer, "writer")?,
                c: need(self.c, "c")?,
                reason: need(self.reason, "reason")?,
                detail: need(self.detail, "detail")?,
                index: self.index.flatten(),
            },
            "ops" => ShellMessage::Ops {
                seq: need(self.seq, "seq")?,
                ops: need(self.ops, "ops")?,
            },
            _ => ShellMessage::Snapshot {
                seq: need(self.seq, "seq")?,
                text: need(self.text, "text")?,
            },
        })
    }
}

/// Perché [`LiveHost::send`](super::LiveHost::send) non ha mandato il
/// messaggio. Lo stato della sessione non è cambiato, salvo per
/// [`SendError::SnapshotTooLarge`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SendError {
    /// La sessione è finita.
    #[error("the live session has ended")]
    Ended,
    /// Nessun commit con quei contatori aspetta una risposta.
    #[error("commit {c} of writer {writer} is not awaiting an answer")]
    UnknownCommit {
        /// Lo scrittore.
        writer: WriterId,
        /// Il contatore.
        c: Counter,
    },
    /// Il contatore del documento torna indietro.
    #[error("seq {seq} is behind the session seq {current}")]
    SeqRegression {
        /// Il contatore del messaggio.
        seq: Counter,
        /// Quello della sessione.
        current: Counter,
    },
    /// Il messaggio non sta in un messaggio WebSocket, o il dettaglio di un
    /// `nack` oltre i 64 KiB.
    #[error("the message of {size} bytes exceeds the limit of {limit}")]
    TooLarge {
        /// I byte.
        size: usize,
        /// Il limite.
        limit: usize,
    },
    /// Lo snapshot supera i 20 MiB: il documento è in sola lettura, e la
    /// sessione finisce con 4008.
    #[error("the snapshot of {size} bytes exceeds 20 MiB: the session ends read-only")]
    SnapshotTooLarge {
        /// I byte del testo.
        size: usize,
    },
}

/// Il QR da mostrare. Contiene il segreto: si mostra solo sul PC.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    /// Il testo del QR, da mostrare anche in chiaro sotto il disegno per chi
    /// non può inquadrare.
    #[serde(serialize_with = "secret_text")]
    pub payload: Zeroizing<String>,
    /// Il QR in SVG, un modulo per unità di `viewBox`.
    pub qr_svg: String,
    /// I millisecondi di validità che restano al segreto.
    pub expires_in_ms: u32,
}

fn secret_text<S: Serializer>(text: &Zeroizing<String>, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(text)
}

impl fmt::Debug for Pairing {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Pairing")
            .field("payload", &"…")
            .field("expires_in_ms", &self.expires_in_ms)
            .finish_non_exhaustive()
    }
}

/// Ciò che della sessione non cambia: dove ascolta e con che certificato.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    /// La sessione.
    pub session: SessionId,
    /// L'indirizzo e la porta del listener.
    pub addr: SocketAddrV4,
    /// L'impronta del certificato effimero.
    pub fingerprint: Fingerprint,
    /// Il nome del PC scritto nel QR.
    pub host_name: Option<String>,
}

impl Serialize for SessionInfo {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut out = serializer.serialize_struct("SessionInfo", 4)?;
        out.serialize_field("session", &self.session.encode())?;
        out.serialize_field("addr", &self.addr.to_string())?;
        out.serialize_field("fingerprint", &self.fingerprint.encode())?;
        out.serialize_field("hostName", &self.host_name)?;
        out.end()
    }
}

/// Un commit in attesa della risposta della shell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PendingCommit {
    /// Lo scrittore.
    pub writer: WriterId,
    /// Il contatore.
    pub c: Counter,
    /// Le operazioni.
    pub ops: Ops,
}

/// Lo stato della sessione, per `live_status`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    /// La sessione è finita o sta finendo.
    pub ended: bool,
    /// Il contatore del documento secondo l'ultimo messaggio della shell.
    pub seq: Counter,
    /// I millisecondi che restano al segreto del QR; `None` se il segreto è
    /// già usato o scaduto.
    pub pairing_expires_in_ms: Option<u32>,
    /// Lo scrittore abbinato.
    pub writer: Option<WriterStatus>,
    /// I commit in attesa della shell, nell'ordine d'arrivo per scrittore.
    pub pending: Vec<PendingCommit>,
    /// I contatori della sessione.
    pub stats: Stats,
}

/// Lo scrittore abbinato.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterStatus {
    /// L'abbinamento.
    pub writer: WriterId,
    /// Il dispositivo.
    pub device: Device,
    /// Le capacità.
    pub caps: Caps,
    /// È collegato in questo momento.
    pub connected: bool,
    /// Fuori dalla connessione: i millisecondi che restano alla ripresa.
    pub resume_expires_in_ms: Option<u32>,
    /// L'ultimo `lastC` mandato nel `welcome`.
    pub last_c: Counter,
    /// La stima dell'orologio.
    pub clock: Option<ClockEstimate>,
}

/// I contatori della sessione, per il pannello di diagnostica della shell.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// I socket accettati.
    #[serde(serialize_with = "decimal")]
    pub accepted: u64,
    /// I socket chiusi appena accettati perché troppi stavano negoziando.
    #[serde(serialize_with = "decimal")]
    pub refused: u64,
    /// Gli ingressi accettati, riprese comprese.
    #[serde(serialize_with = "decimal")]
    pub admitted: u64,
    /// Le connessioni chiuse prima del `welcome`.
    #[serde(serialize_with = "decimal")]
    pub rejected: u64,
    /// I commit ricevuti.
    #[serde(serialize_with = "decimal")]
    pub commits: u64,
    /// I commit a cui la shell ha risposto.
    #[serde(serialize_with = "decimal")]
    pub answered: u64,
}

/// Ciò che resta alla fine della sessione.
#[derive(Debug, Clone, Serialize)]
pub struct StopReport {
    /// I commit a cui la shell non ha risposto: la shell li ha ricevuti come
    /// eventi, ma il canale non è autorevole.
    pub pending: Vec<PendingCommit>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_messages_round_trip_through_text_and_values() {
        let messages = [
            r#"{"t":"ack","writer":"1","c":"2","seq":"7","echo":[{"op":"add"}],"duplicate":false}"#,
            r#"{"t":"nack","writer":"1","c":"3","reason":"missing-parent","detail":"no parent","index":0}"#,
            r#"{"t":"nack","writer":"1","c":"3","reason":"limit","detail":"","index":null}"#,
            r#"{"t":"ops","seq":"8","ops":[{"op":"move","id":"a"}]}"#,
            r#"{"t":"snapshot","seq":"9","text":"<svg/>"}"#,
        ];
        for text in messages {
            let from_text: ShellMessage = serde_json::from_str(text).unwrap();
            assert_eq!(serde_json::to_string(&from_text).unwrap(), text);
            // La via dell'IPC di Tauri: un `Value` già letto.
            let value: serde_json::Value = serde_json::from_str(text).unwrap();
            let from_value: ShellMessage = serde_json::from_value(value).unwrap();
            assert_eq!(from_value, from_text);
        }
        // `index` assente vale `null`.
        let nack: ShellMessage = serde_json::from_str(
            r#"{"t":"nack","writer":"1","c":"3","reason":"cycle","detail":"x"}"#,
        )
        .unwrap();
        assert!(matches!(nack, ShellMessage::Nack { index: None, .. }));
    }

    #[test]
    fn shell_messages_are_read_strictly() {
        for text in [
            r#"{"t":"ack","writer":"1","c":"2","seq":"7","echo":[{"op":"add"}]}"#,
            r#"{"t":"ack","writer":"1","c":"2","seq":"7","echo":[{"op":"add"}],"duplicate":false,"text":""}"#,
            r#"{"t":"ack","writer":1,"c":"2","seq":"7","echo":[{"op":"add"}],"duplicate":false}"#,
            r#"{"t":"ops","seq":"8","ops":[]}"#,
            r#"{"t":"ops","seq":"8","ops":[{"id":"a"}]}"#,
            r#"{"t":"ops","seq":"8","seq":"9","ops":[{"op":"add"}]}"#,
            r#"{"t":"bye","reason":"x"}"#,
            r#"{"seq":"8","ops":[{"op":"add"}]}"#,
            r#"{"t":"snapshot","seq":"9","text":"<svg/>","extra":1}"#,
            r#"["snapshot","9","<svg/>"]"#,
        ] {
            assert!(
                serde_json::from_str::<ShellMessage>(text).is_err(),
                "{text}"
            );
        }
    }

    #[test]
    fn status_and_info_serialize_counters_as_strings() {
        let stats = Stats {
            accepted: 3,
            ..Stats::default()
        };
        let json = serde_json::to_string(&stats).unwrap();
        assert!(
            json.starts_with(r#"{"accepted":"3","refused":"0""#),
            "{json}"
        );
        let info = SessionInfo {
            session: SessionId::parse("AAAAAAAAAAA").unwrap(),
            addr: "192.168.1.2:4000".parse().unwrap(),
            fingerprint: Fingerprint::of_certificate(b"x"),
            host_name: None,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["addr"], "192.168.1.2:4000");
        assert_eq!(json["session"], "AAAAAAAAAAA");
        assert_eq!(json["hostName"], serde_json::Value::Null);
    }
}
