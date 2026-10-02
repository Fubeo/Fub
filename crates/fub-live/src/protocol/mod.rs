//! I messaggi del protocollo, i codici di chiusura e la validazione: le
//! sezioni «Messaggi» e «Codici di chiusura» di
//! `docs/reference/live-session.md`.
//!
//! Ogni messaggio è un oggetto JSON in un frame di testo, `{"v": 1, "t": …}`.
//! La lettura procede a strati, e ogni strato costa al più quanto il
//! precedente ha già ammesso:
//!
//! 1. l'involucro: `v` e `t` letti saltando il resto senza allocarlo. Una
//!    versione diversa da 1 o un tipo sconosciuto in questa direzione finiscono
//!    con 4007;
//! 2. la misura del testo, con il limite del tipo: 64 KiB per `ink.pts`, 8 MiB
//!    per `commit`, 16 KiB per gli altri;
//! 3. la forma: i campi del tipo e nessun altro (`deny_unknown_fields`);
//! 4. i valori: numeri finiti, pressione fra 0 e 1, id e colori nella grafia
//!    del formato, contatori come stringhe decimali.
//!
//! Le operazioni di un commit restano JSON opaco ([`Ops`]): l'host ne controlla
//! solo la forma e la misura, perché le valida e le applica la shell.

mod host;
mod ops;
mod writer;

use std::borrow::Cow;
use std::fmt;
use std::time::Duration;

use serde::de::{self, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};

pub use host::{
    Ack, ByeMessage, DocumentInfo, ErrorMessage, HostMessage, Nack, NackReason, OpsMessage, Pong,
    Snapshot, Welcome,
};
pub use ops::{Ops, OpsError};
pub use writer::{
    Caps, Commit, Credential, Device, Hello, InkBegin, InkPoints, Ping, StrokeId, Tool, View,
    WriterMessage,
};

pub(crate) use host::encode_snapshot;
pub(crate) use writer::{parse_hello, parse_writer, Parsed};

use crate::limits::RATE_COOLDOWN;

/// La versione del protocollo.
pub const VERSION: u64 = 1;

/// I codici di chiusura della sessione, più quelli di RFC 6455 che il
/// server usa per i difetti del trasporto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CloseCode {
    /// 1000: la chiusura normale. Lo scrittore ha salutato con `bye`, o
    /// l'utente ha terminato la sessione sul PC.
    Normal,
    /// 1001: l'host chiude o allontana lo scrittore; si riprova con la ripresa.
    HostClosing,
    /// 1002: il WebSocket stesso è malformato.
    ProtocolError,
    /// 1003: un frame binario, che il protocollo non usa.
    UnsupportedData,
    /// 1007: un messaggio non valido dopo il `hello`.
    InvalidPayload,
    /// 1009: un messaggio oltre il limite del suo tipo o del WebSocket.
    MessageTooBig,
    /// 4001: sessione sconosciuta.
    UnknownSession,
    /// 4002: `hello` non valido.
    InvalidHello,
    /// 4003: c'è già uno scrittore.
    WriterPresent,
    /// 4004: segreto scaduto o già usato, o gettone di ripresa scaduto.
    SecretRejected,
    /// 4005: documento chiuso sul PC.
    DocumentClosed,
    /// 4006: troppo traffico.
    TooMuchTraffic,
    /// 4007: versione o tipo non supportati.
    Unsupported,
    /// 4008: documento in sola lettura o oltre i limiti.
    ReadOnly,
}

/// Che cosa fa lo scrittore dopo una chiusura.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Retry {
    /// Riprova con il gettone di ripresa, entro la finestra di 2 minuti.
    Resume,
    /// Riprova con la ripresa, ma non prima dell'attesa indicata.
    ResumeAfter(Duration),
    /// Non riprova: serve un nuovo abbinamento, o la sessione è finita.
    Never,
}

impl CloseCode {
    const TABLE: [(CloseCode, u16); 14] = [
        (CloseCode::Normal, 1000),
        (CloseCode::HostClosing, 1001),
        (CloseCode::ProtocolError, 1002),
        (CloseCode::UnsupportedData, 1003),
        (CloseCode::InvalidPayload, 1007),
        (CloseCode::MessageTooBig, 1009),
        (CloseCode::UnknownSession, 4001),
        (CloseCode::InvalidHello, 4002),
        (CloseCode::WriterPresent, 4003),
        (CloseCode::SecretRejected, 4004),
        (CloseCode::DocumentClosed, 4005),
        (CloseCode::TooMuchTraffic, 4006),
        (CloseCode::Unsupported, 4007),
        (CloseCode::ReadOnly, 4008),
    ];

    /// Il numero sul filo.
    pub fn code(self) -> u16 {
        Self::TABLE
            .iter()
            .find(|(close, _)| *close == self)
            .map_or(1011, |(_, code)| *code)
    }

    /// Il codice di un numero ricevuto, se il protocollo lo conosce.
    pub fn from_code(code: u16) -> Option<CloseCode> {
        Self::TABLE
            .iter()
            .find(|(_, number)| *number == code)
            .map(|(close, _)| *close)
    }

    /// La colonna «Lo scrittore riprova?» di «Codici di chiusura». I codici di
    /// RFC 6455 dicono che lo scrittore ha mandato qualcosa di sbagliato:
    /// riprovare lo rimanderebbe uguale.
    pub fn retry(self) -> Retry {
        match self {
            CloseCode::HostClosing => Retry::Resume,
            CloseCode::TooMuchTraffic => Retry::ResumeAfter(RATE_COOLDOWN),
            _ => Retry::Never,
        }
    }
}

impl fmt::Display for CloseCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.code())
    }
}

/// Un messaggio che il protocollo non ammette, con il codice che chiude la
/// connessione e un dettaglio in inglese per chi legge i log dell'altro lato.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    /// Il codice di chiusura.
    pub code: CloseCode,
    /// Il dettaglio, che finisce nel messaggio `error`.
    pub detail: String,
}

impl Violation {
    pub(crate) fn new(code: CloseCode, detail: impl Into<String>) -> Violation {
        Violation {
            code,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for Violation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for Violation {}

/// L'involucro di un messaggio: versione e tipo. Gli altri campi si saltano
/// senza allocarli, così un messaggio lungo costa una lettura e niente memoria
/// finché non si sa che tipo è e quanto può pesare. Solo un oggetto è un
/// messaggio: la derivazione di serde accetterebbe anche un array posizionale.
pub(crate) struct Envelope<'a> {
    v: Option<VersionField>,
    t: Option<Cow<'a, str>>,
}

impl<'de> Deserialize<'de> for Envelope<'de> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct E;
        impl<'de> Visitor<'de> for E {
            type Value = Envelope<'de>;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a message object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Envelope<'de>, A::Error> {
                let mut envelope = Envelope { v: None, t: None };
                while let Some(key) = map.next_key::<Cow<'de, str>>()? {
                    match key.as_ref() {
                        "v" if envelope.v.is_some() => return Err(de::Error::duplicate_field("v")),
                        "v" => envelope.v = Some(map.next_value()?),
                        "t" if envelope.t.is_some() => return Err(de::Error::duplicate_field("t")),
                        "t" => envelope.t = Some(map.next_value()?),
                        _ => {
                            map.next_value::<IgnoredAny>()?;
                        }
                    }
                }
                Ok(envelope)
            }
        }
        deserializer.deserialize_map(E)
    }
}

/// Il campo `v`: vale solo l'intero 1. `1.0`, `"1"` o un oggetto sono una
/// versione che il protocollo non conosce, non un messaggio malformato.
#[derive(Debug, PartialEq, Eq)]
enum VersionField {
    One,
    Other,
}

impl<'de> Deserialize<'de> for VersionField {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = VersionField;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a protocol version")
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> Result<VersionField, E> {
                Ok(if value == VERSION {
                    VersionField::One
                } else {
                    VersionField::Other
                })
            }

            fn visit_i64<E: de::Error>(self, _: i64) -> Result<VersionField, E> {
                Ok(VersionField::Other)
            }

            fn visit_f64<E: de::Error>(self, _: f64) -> Result<VersionField, E> {
                Ok(VersionField::Other)
            }

            fn visit_bool<E: de::Error>(self, _: bool) -> Result<VersionField, E> {
                Ok(VersionField::Other)
            }

            fn visit_str<E: de::Error>(self, _: &str) -> Result<VersionField, E> {
                Ok(VersionField::Other)
            }

            fn visit_unit<E: de::Error>(self) -> Result<VersionField, E> {
                Ok(VersionField::Other)
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<VersionField, A::Error> {
                while seq.next_element::<IgnoredAny>()?.is_some() {}
                Ok(VersionField::Other)
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<VersionField, A::Error> {
                while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(VersionField::Other)
            }
        }
        deserializer.deserialize_any(V)
    }
}

/// Che cosa dice l'involucro di un messaggio.
pub(crate) enum Kind<'a> {
    /// Non è un oggetto JSON, o `v` e `t` sono ripetuti o di tipo sbagliato.
    Malformed(String),
    /// Versione assente o diversa da 1.
    UnknownVersion,
    /// Versione 1 e il tipo indicato, ancora da riconoscere.
    Typed(Cow<'a, str>),
}

pub(crate) fn envelope(text: &str) -> Kind<'_> {
    match serde_json::from_str::<Envelope<'_>>(text) {
        Err(error) => Kind::Malformed(error.to_string()),
        Ok(Envelope {
            v: Some(VersionField::One),
            t: Some(t),
        }) => Kind::Typed(t),
        Ok(Envelope {
            v: Some(VersionField::One),
            t: None,
        }) => Kind::Typed(Cow::Borrowed("")),
        Ok(_) => Kind::UnknownVersion,
    }
}

/// Un messaggio in uscita: l'involucro con versione e tipo davanti ai campi.
#[derive(Serialize)]
pub(crate) struct Out<'a, B: Serialize> {
    v: u64,
    t: &'static str,
    #[serde(flatten)]
    body: &'a B,
}

pub(crate) fn encode<B: Serialize>(t: &'static str, body: &B) -> String {
    // La serializzazione di questi tipi non fallisce: chiavi stringa, numeri
    // finiti già controllati, `RawValue` già validato. Un errore qui sarebbe un
    // difetto del crate, e un messaggio vuoto lo fa rifiutare dall'altro lato
    // invece di abbattere il processo.
    serde_json::to_string(&Out {
        v: VERSION,
        t,
        body,
    })
    .unwrap_or_default()
}

/// Un numero JSON che il protocollo ammette: finito. `serde_json` rifiuta già
/// i numeri fuori dall'intervallo di `f64`; NaN e infiniti non sono JSON.
pub(crate) fn finite(value: f64) -> bool {
    value.is_finite()
}

/// Il più grande intero che un numero JavaScript rappresenta esattamente.
pub(crate) const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Un testo leggibile su una riga: niente caratteri di controllo.
pub(crate) fn printable(text: &str) -> bool {
    !text.chars().any(char::is_control)
}

/// Tronca un testo al più a `max` byte, su un confine di carattere.
pub(crate) fn truncate(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_close_code_has_its_number_and_its_retry_policy() {
        let expected = [
            (1000, Retry::Never),
            (1001, Retry::Resume),
            (1002, Retry::Never),
            (1003, Retry::Never),
            (1007, Retry::Never),
            (1009, Retry::Never),
            (4001, Retry::Never),
            (4002, Retry::Never),
            (4003, Retry::Never),
            (4004, Retry::Never),
            (4005, Retry::Never),
            (4006, Retry::ResumeAfter(Duration::from_secs(5))),
            (4007, Retry::Never),
            (4008, Retry::Never),
        ];
        for (number, retry) in expected {
            let code = CloseCode::from_code(number).unwrap();
            assert_eq!(code.code(), number);
            assert_eq!(code.retry(), retry, "{number}");
        }
        assert_eq!(CloseCode::from_code(4009), None);
    }

    #[test]
    fn the_envelope_reads_version_and_type_and_nothing_else() {
        assert!(matches!(envelope(r#"{"v":1,"t":"ping"}"#), Kind::Typed(t) if t == "ping"));
        // I campi sconosciuti dell'involucro si saltano: li rifiuta il tipo.
        assert!(matches!(
            envelope(r#"{"x":[1,{"y":2}],"v":1,"t":"bye"}"#),
            Kind::Typed(t) if t == "bye"
        ));
        for unknown in [
            r#"{"v":2,"t":"ping"}"#,
            r#"{"v":1.0,"t":"ping"}"#,
            r#"{"v":"1","t":"ping"}"#,
            r#"{"v":-1,"t":"ping"}"#,
            r#"{"v":[1],"t":"ping"}"#,
            r#"{"t":"ping"}"#,
        ] {
            assert!(
                matches!(envelope(unknown), Kind::UnknownVersion),
                "{unknown}"
            );
        }
        for malformed in [
            "",
            "[]",
            "1",
            "{",
            r#"{"v":1,"t":"ping"} x"#,
            r#"{"v":1,"v":1,"t":"ping"}"#,
            r#"{"v":1,"t":"ping","t":"bye"}"#,
            r#"{"v":1,"t":7}"#,
        ] {
            assert!(
                matches!(envelope(malformed), Kind::Malformed(_)),
                "{malformed}"
            );
        }
    }

    #[test]
    fn truncation_stays_on_a_character_boundary() {
        assert_eq!(truncate("abc", 5), "abc");
        assert_eq!(truncate("àbc", 1), "");
        assert_eq!(truncate("àbc", 2), "à");
    }
}
