//! I messaggi dall'host allo scrittore.
//!
//! L'host li scrive e il client in Rust li legge con la stessa severità con
//! cui l'host legge lo scrittore: un campo in più, un contatore come numero o
//! un tipo sconosciuto sono un host che non parla questo protocollo.

use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};

use super::ops::Ops;
use super::{encode, envelope, finite, printable, CloseCode, Kind, Violation, MAX_SAFE_INTEGER};
use crate::counter::Counter;
use crate::limits::{Limits, MAX_SNAPSHOT};
use crate::token::{ResumeToken, SessionId};

/// Un messaggio dell'host.
#[derive(Debug, Clone)]
pub enum HostMessage {
    /// L'ingresso accettato.
    Welcome(Welcome),
    /// Il documento intero.
    Snapshot(Snapshot),
    /// Operazioni nate sul PC.
    Ops(OpsMessage),
    /// Un commit applicato.
    Ack(Ack),
    /// Un commit rifiutato.
    Nack(Nack),
    /// La risposta a un `ping`.
    Pong(Pong),
    /// L'errore che precede la chiusura.
    Error(ErrorMessage),
    /// La chiusura dal PC.
    Bye(ByeMessage),
}

/// Il documento della sessione.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentInfo {
    /// L'id del documento: da 1 a 1024 byte leggibili.
    pub id: String,
    /// Il titolo: al più 1024 byte leggibili.
    pub title: String,
}

impl DocumentInfo {
    /// Il documento rispetta i limiti del protocollo.
    pub fn is_valid(&self) -> bool {
        (1..=1024).contains(&self.id.len())
            && printable(&self.id)
            && self.title.len() <= 1024
            && printable(&self.title)
    }
}

/// Il `welcome`.
#[derive(Debug, Clone)]
pub struct Welcome {
    /// La sessione.
    pub session: SessionId,
    /// Il gettone per la prossima ripresa.
    pub resume: ResumeToken,
    /// Il documento.
    pub doc: DocumentInfo,
    /// I limiti della sessione.
    pub limits: Limits,
    /// Il contatore del documento sul PC.
    pub seq: Counter,
    /// L'ultimo commit di questo scrittore che il PC ha già trattato: quelli
    /// fino a qui non vanno rimandati.
    pub last_c: Counter,
}

/// Il documento intero, in SVG.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Snapshot {
    /// Il contatore del documento a cui il testo corrisponde.
    pub seq: Counter,
    /// Il testo SVG.
    pub text: String,
}

/// Operazioni nate sul PC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpsMessage {
    /// Il contatore del documento dopo le operazioni.
    pub seq: Counter,
    /// Le operazioni, in forma canonica.
    pub ops: Ops,
}

/// Un commit applicato.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Ack {
    /// Il contatore del commit.
    pub c: Counter,
    /// Il contatore del documento dopo il commit.
    pub seq: Counter,
    /// Le operazioni applicate, in forma canonica.
    pub echo: Ops,
    /// Il commit era già applicato e identico: il documento non è cambiato.
    pub duplicate: bool,
}

/// I motivi di un rifiuto, gli stessi del motore delle operazioni della shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NackReason {
    /// L'id non esiste.
    MissingTarget,
    /// Il genitore non esiste o non si modifica.
    MissingParent,
    /// L'`after` non esiste o non è un fratello.
    MissingAnchor,
    /// `add` con un id già presente e un elemento diverso.
    DuplicateId,
    /// Elemento fuori dal formato.
    InvalidElem,
    /// Livello bloccato, o la carta.
    Locked,
    /// Dentro un nodo estraneo.
    Foreign,
    /// `move` dentro un discendente.
    Cycle,
    /// Oltre i limiti delle operazioni.
    Limit,
    /// Documento in sola lettura.
    ReadOnly,
}

/// Un commit rifiutato.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Nack {
    /// Il contatore del commit.
    pub c: Counter,
    /// Il motivo.
    pub reason: NackReason,
    /// Il dettaglio leggibile.
    pub detail: String,
    /// L'indice dell'operazione rifiutata, se il motivo ne ha una.
    pub index: Option<u32>,
}

/// La risposta a un `ping`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Pong {
    /// L'id del `ping`.
    pub id: u64,
    /// L'orologio dello scrittore, come l'ha mandato.
    pub a: f64,
    /// L'orologio del PC, in millisecondi dall'epoca Unix.
    pub b: f64,
}

/// L'errore che precede una chiusura.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorMessage {
    /// Il codice di chiusura.
    pub code: u16,
    /// Il dettaglio, in inglese.
    pub detail: String,
}

/// La chiusura dal PC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ByeMessage {
    /// Il motivo, leggibile.
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WelcomeOut<'a> {
    session: String,
    resume: String,
    doc: &'a DocumentInfo,
    limits: &'a Limits,
    seq: Counter,
    last_c: Counter,
}

#[derive(Serialize)]
struct SnapshotOut<'a> {
    seq: Counter,
    text: &'a str,
}

/// Il messaggio `snapshot` senza copiare il testo in un [`Snapshot`]: è il
/// messaggio più grande della sessione.
pub(crate) fn encode_snapshot(seq: Counter, text: &str) -> String {
    encode("snapshot", &SnapshotOut { seq, text })
}

impl HostMessage {
    /// Il testo JSON del messaggio.
    pub fn to_json(&self) -> String {
        match self {
            HostMessage::Welcome(welcome) => encode(
                "welcome",
                &WelcomeOut {
                    session: welcome.session.encode(),
                    resume: welcome.resume.encode(),
                    doc: &welcome.doc,
                    limits: &welcome.limits,
                    seq: welcome.seq,
                    last_c: welcome.last_c,
                },
            ),
            HostMessage::Snapshot(snapshot) => encode_snapshot(snapshot.seq, &snapshot.text),
            HostMessage::Ops(ops) => encode("ops", ops),
            HostMessage::Ack(ack) => encode("ack", ack),
            HostMessage::Nack(nack) => encode("nack", nack),
            HostMessage::Pong(pong) => encode("pong", pong),
            HostMessage::Error(error) => encode("error", error),
            HostMessage::Bye(bye) => encode("bye", bye),
        }
    }

    /// Legge un messaggio dell'host. Il codice della violazione è quello con
    /// cui lo scrittore chiude.
    pub fn parse(text: &str) -> Result<HostMessage, Violation> {
        let invalid = |detail: String| Violation::new(CloseCode::InvalidPayload, detail);
        let kind = match envelope(text) {
            Kind::Malformed(error) => return Err(invalid(format!("malformed message: {error}"))),
            Kind::UnknownVersion => {
                return Err(Violation::new(
                    CloseCode::Unsupported,
                    "unsupported protocol version",
                ))
            }
            Kind::Typed(kind) => kind,
        };
        let parsed = match kind.as_ref() {
            "welcome" => serde_json::from_str::<WelcomeIn>(text).map(WelcomeIn::into_message),
            "snapshot" => serde_json::from_str::<SnapshotIn>(text).map(|wire| {
                HostMessage::Snapshot(Snapshot {
                    seq: wire.seq,
                    text: wire.text,
                })
            }),
            "ops" => serde_json::from_str::<OpsIn>(text).map(|wire| {
                HostMessage::Ops(OpsMessage {
                    seq: wire.seq,
                    ops: wire.ops,
                })
            }),
            "ack" => serde_json::from_str::<AckIn>(text).map(|wire| {
                HostMessage::Ack(Ack {
                    c: wire.c,
                    seq: wire.seq,
                    echo: wire.echo,
                    duplicate: wire.duplicate,
                })
            }),
            "nack" => serde_json::from_str::<NackIn>(text).map(|wire| {
                HostMessage::Nack(Nack {
                    c: wire.c,
                    reason: wire.reason,
                    detail: wire.detail,
                    index: wire.index,
                })
            }),
            "pong" => serde_json::from_str::<PongIn>(text).map(|wire| {
                HostMessage::Pong(Pong {
                    id: wire.id,
                    a: wire.a,
                    b: wire.b,
                })
            }),
            "error" => serde_json::from_str::<ErrorIn>(text).map(|wire| {
                HostMessage::Error(ErrorMessage {
                    code: wire.code,
                    detail: wire.detail,
                })
            }),
            "bye" => serde_json::from_str::<ByeIn>(text).map(|wire| {
                HostMessage::Bye(ByeMessage {
                    reason: wire.reason,
                })
            }),
            other => {
                return Err(Violation::new(
                    CloseCode::Unsupported,
                    format!("unsupported message type {:?}", super::truncate(other, 32)),
                ))
            }
        };
        let message = parsed.map_err(|error| invalid(format!("invalid {kind}: {error}")))?;
        check(&message).map_err(|detail| invalid(format!("invalid {kind}: {detail}")))?;
        Ok(message)
    }
}

/// I testi liberi dell'host restano sotto i 64 KiB: un dettaglio più lungo non
/// è un dettaglio.
const MAX_DETAIL: usize = 64 * 1024;

fn check(message: &HostMessage) -> Result<(), &'static str> {
    match message {
        HostMessage::Welcome(welcome) if !welcome.doc.is_valid() => {
            Err("`doc` exceeds the limits of id or title")
        }
        HostMessage::Snapshot(snapshot) if snapshot.text.len() > MAX_SNAPSHOT => {
            Err("the snapshot exceeds 20 MiB")
        }
        HostMessage::Nack(nack) if nack.detail.len() > MAX_DETAIL => Err("`detail` is too long"),
        HostMessage::Pong(pong)
            if !(pong.id <= MAX_SAFE_INTEGER && finite(pong.a) && finite(pong.b)) =>
        {
            Err("a pong has an id beyond 2^53 or a non-finite clock")
        }
        HostMessage::Error(error)
            if !(1000..=4999).contains(&error.code) || error.detail.len() > MAX_DETAIL =>
        {
            Err("an error has a code outside 1000–4999 or a long detail")
        }
        HostMessage::Bye(bye) if bye.reason.len() > MAX_DETAIL => Err("`reason` is too long"),
        _ => Ok(()),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WelcomeIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    session: SessionText,
    resume: TokenText,
    doc: DocumentInfo,
    limits: Limits,
    seq: Counter,
    last_c: Counter,
}

impl WelcomeIn {
    fn into_message(self) -> HostMessage {
        HostMessage::Welcome(Welcome {
            session: self.session.0,
            resume: self.resume.0,
            doc: self.doc,
            limits: self.limits,
            seq: self.seq,
            last_c: self.last_c,
        })
    }
}

/// Un id di sessione nella sua grafia, letto durante la deserializzazione.
struct SessionText(SessionId);

impl<'de> Deserialize<'de> for SessionText {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = std::borrow::Cow::<'de, str>::deserialize(deserializer)?;
        SessionId::parse(&text)
            .map(SessionText)
            .ok_or_else(|| serde::de::Error::custom("not a session id"))
    }
}

/// Un gettone di ripresa nella sua grafia.
struct TokenText(ResumeToken);

impl<'de> Deserialize<'de> for TokenText {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = zeroize::Zeroizing::new(String::deserialize(deserializer)?);
        ResumeToken::parse(&text)
            .map(TokenText)
            .ok_or_else(|| serde::de::Error::custom("not a resume token"))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    seq: Counter,
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpsIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    seq: Counter,
    ops: Ops,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AckIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    c: Counter,
    seq: Counter,
    echo: Ops,
    duplicate: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NackIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    c: Counter,
    reason: NackReason,
    detail: String,
    index: Option<u32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PongIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    id: u64,
    a: f64,
    b: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ErrorIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    code: u16,
    detail: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ByeIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    reason: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::rand::SystemRandom;

    fn round(message: &HostMessage) -> HostMessage {
        HostMessage::parse(&message.to_json()).unwrap()
    }

    #[test]
    fn every_host_message_goes_and_comes_back() {
        let rng = SystemRandom::new();
        let session = SessionId::generate(&rng).unwrap();
        let resume = ResumeToken::generate(&rng).unwrap();
        let welcome = HostMessage::Welcome(Welcome {
            session,
            resume: resume.clone(),
            doc: DocumentInfo {
                id: "disegni/gatto.svg".into(),
                title: "Gatto".into(),
            },
            limits: Limits::V1,
            seq: Counter(12),
            last_c: Counter(3),
        });
        let json: serde_json::Value = serde_json::from_str(&welcome.to_json()).unwrap();
        assert_eq!(json["v"], 1);
        assert_eq!(json["t"], "welcome");
        assert_eq!(json["seq"], "12");
        assert_eq!(json["lastC"], "3");
        assert_eq!(json["limits"]["inkPts"], 65_536);
        let HostMessage::Welcome(back) = round(&welcome) else {
            panic!("welcome")
        };
        assert!(back.resume.matches(&resume));
        assert_eq!(back.session, session);
        assert_eq!(back.last_c, Counter(3));

        let ops = Ops::parse(r#"[{"op":"add"}]"#, 10).unwrap();
        let ack = HostMessage::Ack(Ack {
            c: Counter(4),
            seq: Counter(13),
            echo: ops.clone(),
            duplicate: true,
        });
        assert!(matches!(round(&ack), HostMessage::Ack(a) if a.duplicate && a.echo == ops));
        let nack = HostMessage::Nack(Nack {
            c: Counter(5),
            reason: NackReason::MissingParent,
            detail: "no layer".into(),
            index: None,
        });
        let json: serde_json::Value = serde_json::from_str(&nack.to_json()).unwrap();
        assert_eq!(json["reason"], "missing-parent");
        assert_eq!(json["index"], serde_json::Value::Null);
        assert!(
            matches!(round(&nack), HostMessage::Nack(n) if n.reason == NackReason::MissingParent)
        );
        let snapshot = HostMessage::Snapshot(Snapshot {
            seq: Counter(1),
            text: "<svg/>".into(),
        });
        assert!(matches!(round(&snapshot), HostMessage::Snapshot(s) if s.text == "<svg/>"));
        let pong = HostMessage::Pong(Pong {
            id: 3,
            a: 10.5,
            b: 1.7e12,
        });
        assert!(matches!(round(&pong), HostMessage::Pong(p) if p.id == 3));
        let error = HostMessage::Error(ErrorMessage {
            code: 4006,
            detail: "rate".into(),
        });
        assert!(matches!(round(&error), HostMessage::Error(e) if e.code == 4006));
        let bye = HostMessage::Bye(ByeMessage {
            reason: "closing".into(),
        });
        assert!(matches!(round(&bye), HostMessage::Bye(b) if b.reason == "closing"));
        let pc = HostMessage::Ops(OpsMessage {
            seq: Counter(14),
            ops,
        });
        assert!(matches!(round(&pc), HostMessage::Ops(o) if o.seq == Counter(14)));
    }

    #[test]
    fn the_client_is_as_strict_as_the_host() {
        for (text, code) in [
            (
                r#"{"v":1,"t":"pong","id":1,"a":1,"b":2,"x":0}"#,
                CloseCode::InvalidPayload,
            ),
            (
                r#"{"v":1,"t":"ack","c":4,"seq":"1","echo":[{"op":"add"}],"duplicate":false}"#,
                CloseCode::InvalidPayload,
            ),
            (
                r#"{"v":1,"t":"nack","c":"4","reason":"nope","detail":"","index":null}"#,
                CloseCode::InvalidPayload,
            ),
            (
                r#"{"v":1,"t":"error","code":99,"detail":""}"#,
                CloseCode::InvalidPayload,
            ),
            (r#"{"v":1,"t":"hello"}"#, CloseCode::Unsupported),
            (
                r#"{"v":2,"t":"pong","id":1,"a":1,"b":2}"#,
                CloseCode::Unsupported,
            ),
        ] {
            assert_eq!(HostMessage::parse(text).unwrap_err().code, code, "{text}");
        }
    }
}
