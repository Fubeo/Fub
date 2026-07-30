//! Regole di serializzazione per il **terzo confine** (Rust ↔ TypeScript via
//! IPC JSON).
//!
//! Accanto alla regola d'oro del WIT ("ogni tipo che attraversa una firma è un
//! record/variant/enum WIT") vive questa, che il WIT non può dare perché il suo
//! `u64` è nativo mentre `JSON.parse` produce `number` a 53 bit di mantissa:
//!
//! > **Gli `u64` che sono identità o impronte — cioè che usano tutti i 64
//! > bit e si confrontano per uguaglianza — attraversano l'IPC JSON come
//! > stringhe** (`#[serde(with = "fub_abi::ipc::u64_string")]`, o un impl
//! > manuale equivalente).
//!
//! Oltre 2⁵³ la precisione di un `number` si perde **in silenzio**: due hash
//! diversi diventano uguali, due id diversi collidono, e il bug è non
//! deterministico e lontanissimo dalla causa. Gli `u64` che invece misurano
//! (timestamp in millisecondi, dimensioni in byte, conteggi) restano numeri:
//! non arrivano a 2⁵³ e la loro aritmetica lato TS è il motivo per cui
//! esistono.
//!
//! Chi è soggetto alla regola oggi: [`JobId`](crate::traits::JobId) (impl
//! manuale, qui accanto) e l'`hash` di `VersionRef` in `fub-features`. Il
//! mirror TS dichiara `string` e la fixture generata da serde
//! (`frontend/src/__fixtures__/`) tiene i due lati allineati.

use serde::{Deserialize, Deserializer, Serializer};

/// `#[serde(default = "fub_abi::ipc::default_true")]` — il default di un
/// campo booleano il cui valore normale è **vero**.
///
/// Serve perché `#[serde(default)]` su un `bool` dà `false`, e un campo assente
/// in un JSON scritto da una versione più vecchia non deve significare il
/// contrario di ciò che quella versione faceva.
pub fn default_true() -> bool {
    true
}

/// `#[serde(with = "fub_abi::ipc::u64_string")]` — serializza un `u64` come
/// stringa decimale, e in lettura accetta **anche** il numero: i dati
/// persistiti prima della regola (indici del versioning) devono restare
/// leggibili.
pub mod u64_string {
    use super::*;

    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(v)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        NumberOrString::deserialize(d)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

/// Un `u64` come arriva dal JSON: già stringa (la regola) o ancora numero
/// (dati scritti prima della regola, o un client che non l'ha recepita).
#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum NumberOrString {
    Number(u64),
    String(String),
}

impl NumberOrString {
    pub(crate) fn parse(self) -> Result<u64, std::num::ParseIntError> {
        match self {
            NumberOrString::Number(n) => Ok(n),
            NumberOrString::String(s) => s.parse(),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde::Serialize;

    #[derive(Serialize, serde::Deserialize, PartialEq, Debug)]
    struct Impronta {
        #[serde(with = "super::u64_string")]
        hash: u64,
    }

    #[test]
    fn a_full_width_u64_survives_the_json_boundary_as_a_string() {
        // Un valore oltre 2^53: come `number` JS perderebbe gli ultimi bit.
        let v = Impronta {
            hash: 0xDEAD_BEEF_CAFE_F00D,
        };
        let json = serde_json::to_string(&v).unwrap();
        assert!(
            json.contains("\"16045690984503111693\""),
            "l'impronta viaggia come stringa: {json}"
        );
        assert_eq!(serde_json::from_str::<Impronta>(&json).unwrap(), v);
    }

    #[test]
    fn data_written_before_the_rule_is_still_readable() {
        let vecchio = r#"{"hash": 42}"#;
        assert_eq!(
            serde_json::from_str::<Impronta>(vecchio).unwrap().hash,
            42,
            "gli indici persistiti col numero nudo restano leggibili"
        );
    }

    #[test]
    fn garbage_is_an_error_not_a_zero() {
        assert!(serde_json::from_str::<Impronta>(r#"{"hash": "x"}"#).is_err());
    }
}
