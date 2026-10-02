//! I messaggi dallo scrittore all'host.

use std::borrow::Cow;
use std::fmt;

use serde::de::{self, IgnoredAny};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::value::RawValue;
use zeroize::Zeroizing;

use super::ops::{Ops, OpsError};
use super::{encode, envelope, finite, printable, CloseCode, Kind, Violation, MAX_SAFE_INTEGER};
use crate::counter::Counter;
use crate::limits::{MAX_COMMIT, MAX_CONTROL, MAX_INK_PTS, MAX_OPS_PER_COMMIT};

/// Un messaggio dello scrittore.
#[derive(Debug, Clone, PartialEq)]
pub enum WriterMessage {
    /// La presentazione, primo messaggio di ogni connessione.
    Hello(Hello),
    /// L'inizio di un tratto.
    InkBegin(InkBegin),
    /// I campioni di un tratto in corso.
    InkPoints(InkPoints),
    /// La fine di un tratto: il commit arriva subito dopo.
    InkEnd(StrokeId),
    /// Un tratto annullato (palmo, `pointercancel`).
    InkCancel(StrokeId),
    /// Un gesto concluso.
    Commit(Commit),
    /// La vista dello scrittore.
    View(View),
    /// Il campione dell'orologio.
    Ping(Ping),
    /// La chiusura volontaria.
    Bye,
}

/// Il `hello`.
#[derive(Debug, Clone, PartialEq)]
pub struct Hello {
    /// L'id di sessione come l'ha letto lo scrittore.
    pub session: String,
    /// Il segreto o il gettone di ripresa.
    pub credential: Credential,
    /// Il dispositivo che si presenta.
    pub device: Device,
    /// Le capacità della penna.
    pub caps: Caps,
}

/// Ciò che autorizza un `hello`: il segreto del QR al primo ingresso, il
/// gettone di ripresa dopo. Il testo si azzera quando il valore esce di scena.
#[derive(Clone, PartialEq, Eq)]
pub enum Credential {
    /// Il segreto di abbinamento.
    Secret(Zeroizing<String>),
    /// Il gettone di ripresa.
    Resume(Zeroizing<String>),
}

impl fmt::Debug for Credential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Credential::Secret(_) => "Secret(…)",
            Credential::Resume(_) => "Resume(…)",
        })
    }
}

/// Il dispositivo dello scrittore, come lo mostra il PC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Device {
    /// Il nome leggibile: da 1 a 64 caratteri, senza caratteri di controllo.
    pub name: String,
    /// Il tipo: minuscole, cifre e trattini, da 1 a 32 byte (`tablet`,
    /// `phone`, …).
    pub kind: String,
}

impl Device {
    /// Il dispositivo rispetta i limiti del protocollo.
    pub fn is_valid(&self) -> bool {
        let chars = self.name.chars().count();
        (1..=64).contains(&chars)
            && printable(&self.name)
            && (1..=32).contains(&self.kind.len())
            && self
                .kind
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    }
}

/// Le capacità della penna dello scrittore.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Caps {
    /// La pressione è misurata.
    pub pressure: bool,
    /// L'inclinazione è misurata.
    pub tilt: bool,
    /// Gli eventi coalescenti sono disponibili.
    pub coalesced: bool,
    /// Gli eventi predetti sono disponibili.
    pub predicted: bool,
}

/// L'id dell'elemento che un tratto diventerà: `o` e 8 caratteri base36
/// minuscoli, come gli id degli oggetti in `formato-scena.md` §7.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct StrokeId([u8; 9]);

impl StrokeId {
    /// Legge un id di oggetto.
    pub fn parse(text: &str) -> Option<StrokeId> {
        let bytes: [u8; 9] = text.as_bytes().try_into().ok()?;
        let valid = bytes[0] == b'o'
            && bytes[1..]
                .iter()
                .all(|byte| byte.is_ascii_digit() || byte.is_ascii_lowercase());
        valid.then_some(StrokeId(bytes))
    }

    /// Il testo dell'id.
    pub fn as_str(&self) -> &str {
        // I byte sono ASCII per costruzione.
        std::str::from_utf8(&self.0).unwrap_or_default()
    }
}

impl fmt::Debug for StrokeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "StrokeId({})", self.as_str())
    }
}

impl fmt::Display for StrokeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl Serialize for StrokeId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for StrokeId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = Cow::<'de, str>::deserialize(deserializer)?;
        StrokeId::parse(&text).ok_or_else(|| de::Error::custom("not an object id"))
    }
}

/// Lo strumento di un tratto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    /// La penna.
    Pen,
    /// L'evidenziatore.
    Highlighter,
}

/// L'inizio di un tratto.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InkBegin {
    /// L'id del futuro elemento.
    pub s: StrokeId,
    /// Il livello che riceverà il tratto: un id, o `#root`.
    pub layer: String,
    /// Lo strumento.
    pub tool: Tool,
    /// Il colore, `#rrggbb` minuscolo.
    pub fill: String,
    /// L'opacità, fra 0 e 1.
    pub fill_opacity: f64,
    /// Il pennello, `pf1 …` (`formato-scena.md` §5).
    pub brush: String,
}

impl InkBegin {
    pub(crate) fn check(&self) -> Result<(), &'static str> {
        if !layer(&self.layer) {
            return Err("`layer` is not a layer id");
        }
        if !color(&self.fill) {
            return Err("`fill` is not a lowercase #rrggbb color");
        }
        if !(finite(self.fill_opacity) && (0.0..=1.0).contains(&self.fill_opacity)) {
            return Err("`fillOpacity` is not a number between 0 and 1");
        }
        if !brush(&self.brush) {
            return Err("`brush` is not a pf1 brush");
        }
        Ok(())
    }
}

/// I campioni di un tratto in corso: `[x, y, p, t]`, con `x` e `y` in
/// coordinate del documento, `p` la pressione fra 0 e 1 e `t` il `timeStamp`
/// dell'evento sull'orologio dello scrittore.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InkPoints {
    /// Il tratto.
    pub s: StrokeId,
    /// I campioni, almeno uno.
    pub pts: Vec<[f64; 4]>,
}

impl InkPoints {
    pub(crate) fn check(&self) -> Result<(), &'static str> {
        if self.pts.is_empty() {
            return Err("`pts` is empty");
        }
        let valid = self.pts.iter().all(|[x, y, p, t]| {
            finite(*x) && finite(*y) && finite(*t) && finite(*p) && (0.0..=1.0).contains(p)
        });
        if valid {
            Ok(())
        } else {
            Err("a sample has a non-finite number or a pressure outside 0–1")
        }
    }
}

/// Un gesto concluso.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Commit {
    /// Il contatore dello scrittore: cresce a ogni commit, a partire da 1.
    pub c: Counter,
    /// Le operazioni.
    pub ops: Ops,
}

/// La vista dello scrittore, in coordinate del documento.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct View {
    /// L'ascissa dell'angolo in alto a sinistra.
    pub x: f64,
    /// L'ordinata dell'angolo in alto a sinistra.
    pub y: f64,
    /// Lo zoom, maggiore di zero.
    pub scale: f64,
    /// La larghezza visibile, maggiore di zero.
    pub w: f64,
    /// L'altezza visibile, maggiore di zero.
    pub h: f64,
}

impl View {
    pub(crate) fn check(&self) -> Result<(), &'static str> {
        let positive = |value: f64| finite(value) && value > 0.0;
        if finite(self.x)
            && finite(self.y)
            && positive(self.scale)
            && positive(self.w)
            && positive(self.h)
        {
            Ok(())
        } else {
            Err("a view has a non-finite number or a non-positive size")
        }
    }
}

/// Il campione dell'orologio dello scrittore.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Ping {
    /// L'id del campione, un intero che JavaScript rappresenta esattamente.
    pub id: u64,
    /// L'orologio dello scrittore, in millisecondi.
    pub a: f64,
}

impl Ping {
    pub(crate) fn check(&self) -> Result<(), &'static str> {
        if self.id <= MAX_SAFE_INTEGER && finite(self.a) {
            Ok(())
        } else {
            Err("a ping has an id beyond 2^53 or a non-finite clock")
        }
    }
}

fn layer(text: &str) -> bool {
    (1..=128).contains(&text.len()) && !text.chars().any(|ch| ch.is_whitespace() || ch.is_control())
}

fn color(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 7
        && bytes[0] == b'#'
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn brush(text: &str) -> bool {
    text.len() <= 1024
        && (text == "pf1" || text.starts_with("pf1 "))
        && text.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
}

// I tipi di lettura: i campi del messaggio più `v` e `t`, già controllati
// dall'involucro, e nessun altro.

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HelloIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    session: String,
    #[serde(default)]
    secret: Option<String>,
    #[serde(default)]
    resume: Option<String>,
    device: Device,
    caps: Caps,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InkBeginIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    s: StrokeId,
    layer: String,
    tool: Tool,
    fill: String,
    fill_opacity: f64,
    brush: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InkPointsIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    s: StrokeId,
    pts: Vec<[f64; 4]>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrokeIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    s: StrokeId,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommitIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    c: Counter,
    ops: Box<RawValue>,
}

/// Il commit oltre gli 8 MiB: se ne legge solo il contatore, per rispondere
/// `nack` con `limit` senza tenere in memoria le operazioni.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommitHead {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    c: Counter,
    #[serde(rename = "ops")]
    _ops: IgnoredAny,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ViewIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    x: f64,
    y: f64,
    scale: f64,
    w: f64,
    h: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PingIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
    id: u64,
    a: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ByeIn {
    #[serde(rename = "v")]
    _v: IgnoredAny,
    #[serde(rename = "t")]
    _t: IgnoredAny,
}

/// I tipi dello scrittore. Quelli dell'host, mandati dallo scrittore, sono un
/// tipo sconosciuto in questa direzione.
const WRITER_TYPES: [&str; 9] = [
    "hello",
    "ink.begin",
    "ink.pts",
    "ink.end",
    "ink.cancel",
    "commit",
    "view",
    "ping",
    "bye",
];

/// L'esito della lettura di un messaggio dopo il `welcome`.
#[derive(Debug)]
pub(crate) enum Parsed {
    /// Un messaggio valido.
    Message(WriterMessage),
    /// Un commit oltre i limiti delle operazioni, 8 MiB o 10 000 operazioni:
    /// l'host risponde `nack` con `limit` senza tenerlo.
    CommitOverLimit {
        /// Il contatore del commit.
        c: Counter,
        /// Il dettaglio del `nack`.
        detail: String,
    },
}

/// Legge il primo messaggio di una connessione, che dev'essere un `hello`.
pub(crate) fn parse_hello(text: &str) -> Result<Hello, Violation> {
    let invalid = |detail: String| Violation::new(CloseCode::InvalidHello, detail);
    let kind = match envelope(text) {
        Kind::Malformed(error) => return Err(invalid(format!("malformed hello: {error}"))),
        Kind::UnknownVersion => {
            return Err(Violation::new(
                CloseCode::Unsupported,
                "unsupported protocol version",
            ))
        }
        Kind::Typed(kind) => kind,
    };
    if !WRITER_TYPES.contains(&kind.as_ref()) {
        return Err(Violation::new(
            CloseCode::Unsupported,
            format!("unsupported message type {:?}", super::truncate(&kind, 32)),
        ));
    }
    if kind != "hello" {
        return Err(invalid(format!("expected hello, got {kind}")));
    }
    if text.len() > MAX_CONTROL {
        return Err(invalid(format!(
            "hello of {} bytes exceeds {MAX_CONTROL}",
            text.len()
        )));
    }
    let wire: HelloIn =
        serde_json::from_str(text).map_err(|error| invalid(format!("invalid hello: {error}")))?;
    let credential = match (wire.secret, wire.resume) {
        (Some(secret), None) => Credential::Secret(Zeroizing::new(secret)),
        (None, Some(resume)) => Credential::Resume(Zeroizing::new(resume)),
        _ => {
            return Err(invalid(
                "a hello carries either `secret` or `resume`".into(),
            ))
        }
    };
    if !wire.device.is_valid() {
        return Err(invalid(
            "`device` exceeds the limits of name or kind".into(),
        ));
    }
    Ok(Hello {
        session: wire.session,
        credential,
        device: wire.device,
        caps: wire.caps,
    })
}

/// Legge un messaggio dopo il `welcome`.
pub(crate) fn parse_writer(text: &str) -> Result<Parsed, Violation> {
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
    let limit = match kind.as_ref() {
        "ink.pts" => MAX_INK_PTS,
        "commit" => MAX_COMMIT,
        other if WRITER_TYPES.contains(&other) => MAX_CONTROL,
        other => {
            return Err(Violation::new(
                CloseCode::Unsupported,
                format!("unsupported message type {:?}", super::truncate(other, 32)),
            ))
        }
    };
    if kind == "hello" {
        return Err(Violation::new(
            CloseCode::InvalidHello,
            "hello after welcome",
        ));
    }
    if kind == "commit" {
        return commit(text);
    }
    if text.len() > limit {
        return Err(Violation::new(
            CloseCode::MessageTooBig,
            format!("{kind} of {} bytes exceeds {limit}", text.len()),
        ));
    }
    let message =
        typed(kind.as_ref(), text).map_err(|error| invalid(format!("invalid {kind}: {error}")))?;
    let checked = match &message {
        WriterMessage::InkBegin(begin) => begin.check(),
        WriterMessage::InkPoints(points) => points.check(),
        WriterMessage::View(view) => view.check(),
        WriterMessage::Ping(ping) => ping.check(),
        _ => Ok(()),
    };
    checked.map_err(|detail| invalid(format!("invalid {kind}: {detail}")))?;
    Ok(Parsed::Message(message))
}

/// Un commit. Oltre gli 8 MiB se ne legge solo il contatore; oltre le 10 000
/// operazioni la lettura si ferma alla prima di troppo. In entrambi i casi è
/// un'operazione oltre i limiti di `operazioni.md` §5, che l'host rifiuta con
/// `limit` come farebbe la shell, senza chiudere la connessione.
fn commit(text: &str) -> Result<Parsed, Violation> {
    let invalid = |detail: String| Violation::new(CloseCode::InvalidPayload, detail);
    if text.len() > MAX_COMMIT {
        let head: CommitHead = serde_json::from_str(text)
            .map_err(|error| invalid(format!("invalid commit: {error}")))?;
        check_counter(head.c).map_err(|detail| invalid(format!("invalid commit: {detail}")))?;
        let detail = format!("a commit of {} bytes exceeds {MAX_COMMIT}", text.len());
        return Ok(Parsed::CommitOverLimit { c: head.c, detail });
    }
    let wire: CommitIn =
        serde_json::from_str(text).map_err(|error| invalid(format!("invalid commit: {error}")))?;
    check_counter(wire.c).map_err(|detail| invalid(format!("invalid commit: {detail}")))?;
    match Ops::from_raw(wire.ops, MAX_OPS_PER_COMMIT) {
        Ok(ops) => Ok(Parsed::Message(WriterMessage::Commit(Commit {
            c: wire.c,
            ops,
        }))),
        Err(OpsError::TooMany { limit, .. }) => Ok(Parsed::CommitOverLimit {
            c: wire.c,
            detail: format!("a commit carries more than {limit} operations"),
        }),
        Err(error) => Err(invalid(format!("invalid commit: {error}"))),
    }
}

fn check_counter(c: Counter) -> Result<(), &'static str> {
    if c.0 == 0 {
        Err("`c` starts from 1")
    } else {
        Ok(())
    }
}

fn typed(kind: &str, text: &str) -> Result<WriterMessage, serde_json::Error> {
    Ok(match kind {
        "ink.begin" => {
            let wire: InkBeginIn = serde_json::from_str(text)?;
            WriterMessage::InkBegin(InkBegin {
                s: wire.s,
                layer: wire.layer,
                tool: wire.tool,
                fill: wire.fill,
                fill_opacity: wire.fill_opacity,
                brush: wire.brush,
            })
        }
        "ink.pts" => {
            let wire: InkPointsIn = serde_json::from_str(text)?;
            WriterMessage::InkPoints(InkPoints {
                s: wire.s,
                pts: wire.pts,
            })
        }
        "ink.end" => WriterMessage::InkEnd(serde_json::from_str::<StrokeIn>(text)?.s),
        "ink.cancel" => WriterMessage::InkCancel(serde_json::from_str::<StrokeIn>(text)?.s),
        "view" => {
            let wire: ViewIn = serde_json::from_str(text)?;
            WriterMessage::View(View {
                x: wire.x,
                y: wire.y,
                scale: wire.scale,
                w: wire.w,
                h: wire.h,
            })
        }
        "ping" => {
            let wire: PingIn = serde_json::from_str(text)?;
            WriterMessage::Ping(Ping {
                id: wire.id,
                a: wire.a,
            })
        }
        _ => {
            serde_json::from_str::<ByeIn>(text)?;
            WriterMessage::Bye
        }
    })
}

#[derive(Serialize)]
struct HelloOut<'a> {
    session: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    secret: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resume: Option<&'a str>,
    device: &'a Device,
    caps: &'a Caps,
}

#[derive(Serialize)]
struct StrokeOut {
    s: StrokeId,
}

#[derive(Serialize)]
struct Empty {}

impl WriterMessage {
    /// Il testo JSON del messaggio.
    pub fn to_json(&self) -> String {
        match self {
            WriterMessage::Hello(hello) => {
                let (secret, resume) = match &hello.credential {
                    Credential::Secret(secret) => (Some(secret.as_str()), None),
                    Credential::Resume(resume) => (None, Some(resume.as_str())),
                };
                encode(
                    "hello",
                    &HelloOut {
                        session: &hello.session,
                        secret,
                        resume,
                        device: &hello.device,
                        caps: &hello.caps,
                    },
                )
            }
            WriterMessage::InkBegin(begin) => encode("ink.begin", begin),
            WriterMessage::InkPoints(points) => encode("ink.pts", points),
            WriterMessage::InkEnd(s) => encode("ink.end", &StrokeOut { s: *s }),
            WriterMessage::InkCancel(s) => encode("ink.cancel", &StrokeOut { s: *s }),
            WriterMessage::Commit(commit) => encode("commit", commit),
            WriterMessage::View(view) => encode("view", view),
            WriterMessage::Ping(ping) => encode("ping", ping),
            WriterMessage::Bye => encode("bye", &Empty {}),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello_json(extra: &str) -> String {
        format!(
            r#"{{"v":1,"t":"hello","session":"AAAAAAAAAAA","secret":"AAAAAAAAAAAAAAAAAAAAAA","device":{{"name":"Tablet di Ada","kind":"tablet"}},"caps":{{"pressure":true,"tilt":false,"coalesced":true,"predicted":false}}{extra}}}"#
        )
    }

    fn code_of_hello(text: &str) -> CloseCode {
        parse_hello(text).unwrap_err().code
    }

    fn code_of(text: &str) -> CloseCode {
        parse_writer(text).unwrap_err().code
    }

    fn message(text: &str) -> WriterMessage {
        match parse_writer(text).unwrap() {
            Parsed::Message(message) => message,
            Parsed::CommitOverLimit { c, detail } => panic!("commit {c} over the limits: {detail}"),
        }
    }

    #[test]
    fn a_valid_hello_is_read_with_its_credential() {
        let hello = parse_hello(&hello_json("")).unwrap();
        assert_eq!(hello.session, "AAAAAAAAAAA");
        assert!(matches!(hello.credential, Credential::Secret(_)));
        assert_eq!(hello.device.kind, "tablet");
        assert!(hello.caps.pressure && hello.caps.coalesced);
        // Andata e ritorno: il client scrive ciò che l'host legge.
        let again = parse_hello(&WriterMessage::Hello(hello.clone()).to_json()).unwrap();
        assert_eq!(again, hello);
    }

    #[test]
    fn a_hello_out_of_shape_closes_with_4002() {
        assert_eq!(code_of_hello("not json"), CloseCode::InvalidHello);
        assert_eq!(
            code_of_hello(&hello_json(r#","extra":1"#)),
            CloseCode::InvalidHello
        );
        assert_eq!(
            code_of_hello(&hello_json(r#","resume":"AAAAAAAAAAAAAAAAAAAAAA""#)),
            CloseCode::InvalidHello
        );
        let without = hello_json("").replace(r#""secret":"AAAAAAAAAAAAAAAAAAAAAA","#, "");
        assert_eq!(code_of_hello(&without), CloseCode::InvalidHello);
        let nameless = hello_json("").replace("Tablet di Ada", "");
        assert_eq!(code_of_hello(&nameless), CloseCode::InvalidHello);
        let control = hello_json("").replace("Tablet di Ada", "Tab\\u0007");
        assert_eq!(code_of_hello(&control), CloseCode::InvalidHello);
        let kind = hello_json("").replace(r#""tablet""#, r#""Tablet""#);
        assert_eq!(code_of_hello(&kind), CloseCode::InvalidHello);
        let long = hello_json(&format!(r#","pad":"{}""#, "x".repeat(MAX_CONTROL)));
        assert_eq!(code_of_hello(&long), CloseCode::InvalidHello);
        // Un tipo noto che non è `hello`.
        assert_eq!(
            code_of_hello(r#"{"v":1,"t":"bye"}"#),
            CloseCode::InvalidHello
        );
    }

    #[test]
    fn version_and_type_come_before_the_shape_of_the_hello() {
        assert_eq!(
            code_of_hello(&hello_json("").replace(r#""v":1"#, r#""v":2"#)),
            CloseCode::Unsupported
        );
        assert_eq!(
            code_of_hello(r#"{"v":1,"t":"helo"}"#),
            CloseCode::Unsupported
        );
        // Un tipo dell'host, mandato dallo scrittore.
        assert_eq!(
            code_of_hello(r#"{"v":1,"t":"welcome"}"#),
            CloseCode::Unsupported
        );
        assert_eq!(code_of_hello(r#"{"v":3}"#), CloseCode::Unsupported);
    }

    #[test]
    fn ink_messages_are_read_and_checked() {
        let begin = message(
            r##"{"v":1,"t":"ink.begin","s":"o7k2m9x4q","layer":"l1a2b3c4d","tool":"pen","fill":"#0072b2","fillOpacity":1,"brush":"pf1 size=4"}"##,
        );
        assert!(matches!(begin, WriterMessage::InkBegin(ref b) if b.tool == Tool::Pen));
        let points = message(
            r#"{"v":1,"t":"ink.pts","s":"o7k2m9x4q","pts":[[1.25,2.5,0.5,1000],[2,3,1,1008.5]]}"#,
        );
        assert!(matches!(points, WriterMessage::InkPoints(ref p) if p.pts.len() == 2));
        assert!(matches!(
            message(r#"{"v":1,"t":"ink.end","s":"o7k2m9x4q"}"#),
            WriterMessage::InkEnd(_)
        ));
        assert!(matches!(
            message(r#"{"v":1,"t":"ink.cancel","s":"o7k2m9x4q"}"#),
            WriterMessage::InkCancel(_)
        ));
        for round in [begin, points] {
            assert_eq!(message(&round.to_json()), round);
        }
    }

    #[test]
    fn ink_out_of_range_closes_with_1007() {
        let begin = r##"{"v":1,"t":"ink.begin","s":"o7k2m9x4q","layer":"l1a2b3c4d","tool":"pen","fill":"#0072b2","fillOpacity":1,"brush":"pf1 size=4"}"##;
        for (from, to) in [
            ("o7k2m9x4q", "O7K2M9X4Q"),
            ("o7k2m9x4q", "o7k2m9x4"),
            ("o7k2m9x4q", "x7k2m9x4q"),
            ("l1a2b3c4d", "l1 a2"),
            ("l1a2b3c4d", ""),
            ("\"pen\"", "\"brush\""),
            ("#0072b2", "#0072B2"),
            ("#0072b2", "#07b"),
            ("#0072b2", "red"),
            ("\"fillOpacity\":1", "\"fillOpacity\":1.5"),
            ("\"fillOpacity\":1", "\"fillOpacity\":-0.1"),
            ("pf1 size=4", "pf2 size=4"),
            ("pf1 size=4", "pf10"),
            ("pf1 size=4", "pf1 size=4\\n"),
        ] {
            let text = begin.replace(from, to);
            assert_eq!(code_of(&text), CloseCode::InvalidPayload, "{text}");
        }
        for pts in [
            "[]",
            "[[1,2,3]]",
            "[[1,2,0.5,4,5]]",
            "[[1,2,1.5,4]]",
            "[[1,2,-0.5,4]]",
            "[[1,2,0.5,\"4\"]]",
            "[[1e999,2,0.5,4]]",
            "[[null,2,0.5,4]]",
        ] {
            let text = format!(r#"{{"v":1,"t":"ink.pts","s":"o7k2m9x4q","pts":{pts}}}"#);
            assert_eq!(code_of(&text), CloseCode::InvalidPayload, "{text}");
        }
    }

    #[test]
    fn every_type_has_its_size_limit() {
        // `ink.pts` fino a 64 KiB.
        let sample = "[1.25,2.5,0.5,1000.125],";
        let count = (MAX_INK_PTS - 64) / sample.len();
        let body = sample.repeat(count);
        let fits = format!(
            r#"{{"v":1,"t":"ink.pts","s":"o7k2m9x4q","pts":[{}]}}"#,
            &body[..body.len() - 1]
        );
        assert!(fits.len() <= MAX_INK_PTS);
        assert!(matches!(message(&fits), WriterMessage::InkPoints(_)));
        let body = sample.repeat(count + 8);
        let over = format!(
            r#"{{"v":1,"t":"ink.pts","s":"o7k2m9x4q","pts":[{}]}}"#,
            &body[..body.len() - 1]
        );
        assert!(over.len() > MAX_INK_PTS);
        assert_eq!(code_of(&over), CloseCode::MessageTooBig);
        // Gli altri tipi fino a 16 KiB.
        let view = format!(
            r#"{{"v":1,"t":"view","x":0,"y":0,"scale":1,"w":1,"h":1{}}}"#,
            " ".repeat(MAX_CONTROL)
        );
        assert_eq!(code_of(&view), CloseCode::MessageTooBig);
    }

    #[test]
    fn a_commit_is_read_and_one_beyond_8_mib_keeps_only_its_counter() {
        let commit = message(r#"{"v":1,"t":"commit","c":"7","ops":[{"op":"add"}]}"#);
        assert!(
            matches!(commit, WriterMessage::Commit(ref c) if c.c == Counter(7) && c.ops.count() == 1)
        );
        assert_eq!(message(&commit.to_json()), commit);
        let big = format!(
            r#"{{"v":1,"t":"commit","c":"8","ops":[{{"op":"add","x":"{}"}}]}}"#,
            "a".repeat(MAX_COMMIT)
        );
        assert!(matches!(
            parse_writer(&big),
            Ok(Parsed::CommitOverLimit { c: Counter(8), ref detail }) if detail.contains("exceeds")
        ));
        let unreadable = big.replace(r#""c":"8""#, r#""c":8"#);
        assert_eq!(code_of(&unreadable), CloseCode::InvalidPayload);
    }

    #[test]
    fn a_commit_out_of_shape_closes_with_1007() {
        for text in [
            r#"{"v":1,"t":"commit","c":7,"ops":[{"op":"add"}]}"#,
            r#"{"v":1,"t":"commit","c":"0","ops":[{"op":"add"}]}"#,
            r#"{"v":1,"t":"commit","c":"07","ops":[{"op":"add"}]}"#,
            r#"{"v":1,"t":"commit","c":"7","ops":[]}"#,
            r#"{"v":1,"t":"commit","c":"7","ops":{"op":"add"}}"#,
            r#"{"v":1,"t":"commit","c":"7","ops":[{"id":"o1"}]}"#,
            r#"{"v":1,"t":"commit","c":"7","ops":[{"op":"add"}],"extra":true}"#,
        ] {
            assert_eq!(code_of(text), CloseCode::InvalidPayload, "{text}");
        }
    }

    #[test]
    fn a_commit_beyond_10000_operations_keeps_only_its_counter() {
        let at = |count: usize| {
            format!(
                r#"{{"v":1,"t":"commit","c":"7","ops":[{}]}}"#,
                vec![r#"{"op":"add"}"#; count].join(",")
            )
        };
        assert!(
            matches!(message(&at(10_000)), WriterMessage::Commit(ref c) if c.ops.count() == 10_000)
        );
        assert!(matches!(
            parse_writer(&at(10_001)),
            Ok(Parsed::CommitOverLimit { c: Counter(7), ref detail }) if detail.contains("10000")
        ));
        // Oltre il limite, un'operazione malformata dopo la prima di troppo non
        // si legge più: il commit è rifiutato per il numero.
        let tail = at(10_002).replace(r#"{"op":"add"}]"#, r#"{"op":1}]"#);
        assert!(matches!(
            parse_writer(&tail),
            Ok(Parsed::CommitOverLimit { .. })
        ));
    }

    #[test]
    fn view_ping_and_bye_are_checked() {
        assert!(matches!(
            message(r#"{"v":1,"t":"view","x":-10.5,"y":3,"scale":2,"w":800,"h":600}"#),
            WriterMessage::View(_)
        ));
        for text in [
            r#"{"v":1,"t":"view","x":0,"y":0,"scale":0,"w":800,"h":600}"#,
            r#"{"v":1,"t":"view","x":0,"y":0,"scale":1,"w":-1,"h":600}"#,
            r#"{"v":1,"t":"view","x":0,"y":0,"scale":1,"w":800}"#,
            r#"{"v":1,"t":"ping","id":9007199254740992,"a":1}"#,
            r#"{"v":1,"t":"ping","id":-1,"a":1}"#,
            r#"{"v":1,"t":"ping","id":1.5,"a":1}"#,
            r#"{"v":1,"t":"bye","reason":"x"}"#,
        ] {
            assert_eq!(code_of(text), CloseCode::InvalidPayload, "{text}");
        }
        assert!(matches!(
            message(r#"{"v":1,"t":"ping","id":9007199254740991,"a":12.5}"#),
            WriterMessage::Ping(_)
        ));
        assert_eq!(message(r#"{"v":1,"t":"bye"}"#), WriterMessage::Bye);
        assert_eq!(message(&WriterMessage::Bye.to_json()), WriterMessage::Bye);
    }

    #[test]
    fn unknown_types_and_versions_close_with_4007_and_a_second_hello_with_4002() {
        assert_eq!(code_of(r#"{"v":1,"t":"teleport"}"#), CloseCode::Unsupported);
        assert_eq!(
            code_of(r#"{"v":1,"t":"ack","c":"1"}"#),
            CloseCode::Unsupported
        );
        assert_eq!(
            code_of(r#"{"v":2,"t":"ping","id":1,"a":1}"#),
            CloseCode::Unsupported
        );
        assert_eq!(code_of(&hello_json("")), CloseCode::InvalidHello);
        assert_eq!(code_of("[1,2]"), CloseCode::InvalidPayload);
    }
}
