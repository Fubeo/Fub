//! I contatori del protocollo — `seq`, `c`, `lastC` — e l'id dello scrittore.
//!
//! In JSON un `u64` viaggia come stringa decimale: è la regola di Fub, perché
//! un numero JavaScript perde le cifre oltre 2^53. `fub_abi::ipc::u64_string`
//! la applica ai comandi IPC, ma questo crate non dipende da `fub-abi`, e qui
//! la regola è più stretta: un contatore che arriva come numero si rifiuta
//! invece di essere accettato, perché il protocollo è nuovo e non ha client
//! vecchi da tollerare, e la grafia è una sola (`0` oppure una cifra diversa
//! da zero seguita da cifre), così due stringhe diverse non nominano mai lo
//! stesso contatore.

use std::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Un contatore del protocollo: `seq` dell'host, `c` e `lastC` dello scrittore.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Counter(pub u64);

/// L'id di un abbinamento dello scrittore. I contatori `c` sono suoi: un
/// tablet abbinato di nuovo ricomincia da 1, e la shell risponde a un commit
/// nominando entrambi, così un `ack` in ritardo non tocca il commit omonimo di
/// un abbinamento successivo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct WriterId(pub u64);

/// Legge la grafia canonica di un `u64` decimale.
pub(crate) fn parse_canonical(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    let canonical = match bytes {
        [] => false,
        [b'0'] => true,
        [first, rest @ ..] => (b'1'..=b'9').contains(first) && rest.iter().all(u8::is_ascii_digit),
    };
    if !canonical {
        return None;
    }
    // Le cifre sono già controllate: l'unico errore che resta è il trabocco.
    text.parse().ok()
}

struct CanonicalVisitor;

impl Visitor<'_> for CanonicalVisitor {
    type Value = u64;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a canonical decimal u64 as a string")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<u64, E> {
        parse_canonical(value).ok_or_else(|| E::invalid_value(de::Unexpected::Str(value), &self))
    }
}

macro_rules! decimal_string {
    ($name:ident) => {
        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.collect_str(&self.0)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                deserializer.deserialize_str(CanonicalVisitor).map($name)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(&self.0, formatter)
            }
        }
    };
}

decimal_string!(Counter);
decimal_string!(WriterId);

/// Un `u64` che non è un contatore, come le statistiche, esce con la stessa
/// regola: stringa decimale.
pub(crate) fn decimal<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_str(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_counter_travels_as_a_decimal_string() {
        assert_eq!(serde_json::to_string(&Counter(0)).unwrap(), r#""0""#);
        assert_eq!(
            serde_json::to_string(&Counter(u64::MAX)).unwrap(),
            r#""18446744073709551615""#
        );
        let back: Counter = serde_json::from_str(r#""18446744073709551615""#).unwrap();
        assert_eq!(back, Counter(u64::MAX));
        assert_eq!(serde_json::to_string(&WriterId(7)).unwrap(), r#""7""#);
    }

    #[test]
    fn only_the_canonical_spelling_is_a_counter() {
        for text in ["0", "1", "10", "9007199254740993"] {
            assert!(parse_canonical(text).is_some(), "{text}");
        }
        for json in [
            "1",
            "1.0",
            "-1",
            r#""""#,
            r#""01""#,
            r#""00""#,
            r#""+1""#,
            r#""-1""#,
            r#"" 1""#,
            r#""1 ""#,
            r#""1e3""#,
            r#""0x10""#,
            r#""١""#,
            r#""18446744073709551616""#,
            "null",
            "true",
            "[]",
        ] {
            assert!(serde_json::from_str::<Counter>(json).is_err(), "{json}");
        }
    }
}
