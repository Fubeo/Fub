//! Le operazioni come JSON opaco.
//!
//! L'host non applica le operazioni: le valida e le applica la shell, con il
//! motore delle operazioni della scena. Qui se ne controlla solo la forma —
//! un array di oggetti, ognuno con un campo `op` stringa e uno solo — e la
//! misura, e il testo resta quello ricevuto, senza un albero
//! `serde_json::Value` che per un commit di 8 MiB di numeri piccoli
//! peserebbe dieci volte tanto.

use std::borrow::Cow;
use std::cell::Cell;
use std::fmt;
use std::sync::Arc;

use serde::de::{self, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::value::RawValue;

/// Le operazioni di un commit, di un'eco o di un messaggio `ops`: il testo
/// JSON di un array di operazioni, controllato nella forma.
#[derive(Clone)]
pub struct Ops {
    raw: Arc<RawValue>,
    count: usize,
}

/// Perché un testo non è un array di operazioni.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OpsError {
    /// Il testo non è un array di oggetti con un `op` stringa.
    #[error("operations are not an array of objects with a string `op`: {0}")]
    Shape(String),
    /// L'array è vuoto.
    #[error("a commit carries at least one operation")]
    Empty,
    /// Più operazioni del limite.
    #[error("{count} operations exceed the limit of {limit}")]
    TooMany {
        /// Le operazioni contate fino al superamento.
        count: usize,
        /// Il limite.
        limit: usize,
    },
}

impl Ops {
    /// Controlla un testo JSON e lo tiene così com'è. `limit` è il numero
    /// massimo di operazioni; un array vuoto non è ammesso.
    pub fn parse(json: &str, limit: usize) -> Result<Ops, OpsError> {
        let raw = RawValue::from_string(json.to_owned())
            .map_err(|error| OpsError::Shape(error.to_string()))?;
        Ops::from_raw(raw, limit)
    }

    /// Costruisce le operazioni da valori già in memoria: è la via del client e
    /// delle prove, che le hanno come `serde_json::Value`.
    pub fn from_values(values: &[serde_json::Value], limit: usize) -> Result<Ops, OpsError> {
        let json =
            serde_json::to_string(values).map_err(|error| OpsError::Shape(error.to_string()))?;
        Ops::parse(&json, limit)
    }

    pub(crate) fn from_raw(raw: Box<RawValue>, limit: usize) -> Result<Ops, OpsError> {
        let count = shape(raw.get(), limit)?;
        Ok(Ops {
            raw: Arc::from(raw),
            count,
        })
    }

    /// Il testo JSON delle operazioni.
    pub fn json(&self) -> &str {
        self.raw.get()
    }

    /// Il numero di operazioni.
    pub fn count(&self) -> usize {
        self.count
    }

    /// I byte del testo JSON.
    pub fn byte_len(&self) -> usize {
        self.raw.get().len()
    }

    /// Le operazioni come valori: comodo per chi le confronta, costoso per un
    /// commit grande.
    pub fn to_values(&self) -> Vec<serde_json::Value> {
        serde_json::from_str(self.raw.get()).unwrap_or_default()
    }
}

impl PartialEq for Ops {
    fn eq(&self, other: &Ops) -> bool {
        self.raw.get() == other.raw.get()
    }
}

impl Eq for Ops {}

impl fmt::Debug for Ops {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Ops({} operations, {} bytes)",
            self.count,
            self.byte_len()
        )
    }
}

impl Serialize for Ops {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.raw.serialize(serializer)
    }
}

/// Le operazioni ricevute dalla shell (`ops`, eco di un `ack`): nessun limite
/// di numero oltre la misura del messaggio, che l'host controlla a parte.
impl<'de> Deserialize<'de> for Ops {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = Box::<RawValue>::deserialize(deserializer)?;
        Ops::from_raw(raw, usize::MAX).map_err(de::Error::custom)
    }
}

/// Conta le operazioni di un array e ne controlla la forma, senza allocare
/// niente oltre ai nomi delle chiavi con escape.
fn shape(json: &str, limit: usize) -> Result<usize, OpsError> {
    let overflow = Cell::new(None);
    let mut deserializer = serde_json::Deserializer::from_str(json);
    let count = deserializer
        .deserialize_seq(ArrayOfOps {
            limit,
            overflow: &overflow,
        })
        .map_err(|error| match overflow.get() {
            Some(count) => OpsError::TooMany { count, limit },
            None => OpsError::Shape(error.to_string()),
        })?;
    deserializer
        .end()
        .map_err(|error| OpsError::Shape(error.to_string()))?;
    if count == 0 {
        return Err(OpsError::Empty);
    }
    Ok(count)
}

/// Il visitatore dell'array: conta e si ferma al primo elemento oltre il
/// limite, che annota in `overflow` perché un errore di serde porta solo testo.
struct ArrayOfOps<'a> {
    limit: usize,
    overflow: &'a Cell<Option<usize>>,
}

impl<'de> Visitor<'de> for ArrayOfOps<'_> {
    type Value = usize;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("an array of operations")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<usize, A::Error> {
        let mut count = 0usize;
        while seq.next_element::<OpShape>()?.is_some() {
            count += 1;
            if count > self.limit {
                self.overflow.set(Some(count));
                return Err(de::Error::custom("too many operations"));
            }
        }
        Ok(count)
    }
}

/// La profondità massima di un array di operazioni, array compreso: quella
/// con cui `serde_json` costruisce un `Value` (127 contenitori annidati), così
/// chi converte non trova un testo che l'host ha accettato e lui non sa
/// leggere. Un gruppo annidato
/// costa due livelli (l'elemento e i suoi figli), e i 32 gruppi annidati che
/// le operazioni della scena ammettono ci stanno con margine.
const MAX_DEPTH: usize = 128;

/// Un'operazione: un oggetto con un campo `op`, una sola volta, il cui valore
/// è un nome in minuscolo. Una chiave ripetuta altrove si lascia alla shell;
/// `op` ripetuto no, perché chi legge il primo e chi legge l'ultimo vedrebbero
/// due operazioni diverse.
struct OpShape;

impl<'de> Deserialize<'de> for OpShape {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(OpShapeVisitor)
    }
}

struct OpShapeVisitor;

impl<'de> Visitor<'de> for OpShapeVisitor {
    type Value = OpShape;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("an operation object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<OpShape, A::Error> {
        let mut seen = false;
        while let Some(key) = map.next_key::<Cow<'de, str>>()? {
            if key == "op" {
                if seen {
                    return Err(de::Error::custom("duplicate field `op`"));
                }
                seen = true;
                let name = map.next_value::<Cow<'de, str>>()?;
                if !op_name(&name) {
                    return Err(de::Error::custom("`op` is not an operation name"));
                }
            } else {
                // L'array e l'oggetto dell'operazione sono i primi due livelli.
                map.next_value_seed(Nested { depth: 3 })?;
            }
        }
        if !seen {
            return Err(de::Error::missing_field("op"));
        }
        Ok(OpShape)
    }
}

/// Un valore qualunque, letto senza allocarlo, che non scende oltre
/// [`MAX_DEPTH`].
#[derive(Clone, Copy)]
struct Nested {
    depth: usize,
}

impl<'de> de::DeserializeSeed<'de> for Nested {
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Nested {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_bool<E: de::Error>(self, _: bool) -> Result<(), E> {
        Ok(())
    }

    fn visit_i64<E: de::Error>(self, _: i64) -> Result<(), E> {
        Ok(())
    }

    fn visit_u64<E: de::Error>(self, _: u64) -> Result<(), E> {
        Ok(())
    }

    fn visit_f64<E: de::Error>(self, _: f64) -> Result<(), E> {
        Ok(())
    }

    fn visit_str<E: de::Error>(self, _: &str) -> Result<(), E> {
        Ok(())
    }

    fn visit_unit<E: de::Error>(self) -> Result<(), E> {
        Ok(())
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        let inner = self.deeper()?;
        while seq.next_element_seed(inner)?.is_some() {}
        Ok(())
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let inner = self.deeper()?;
        while map.next_key::<IgnoredAny>()?.is_some() {
            map.next_value_seed(inner)?;
        }
        Ok(())
    }
}

impl Nested {
    fn deeper<E: de::Error>(self) -> Result<Nested, E> {
        if self.depth >= MAX_DEPTH {
            return Err(E::custom(format_args!(
                "operations nest beyond {MAX_DEPTH} levels"
            )));
        }
        Ok(Nested {
            depth: self.depth + 1,
        })
    }
}

/// Un nome d'operazione: minuscole, cifre e trattini, al più 32 byte. Il
/// motore conosce i nomi veri; qui basta che non sia un testo arbitrario.
fn op_name(name: &str) -> bool {
    (1..=32).contains(&name.len())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_array_of_operations_keeps_its_text() {
        let json = r#"[{"op":"add","parent":"l1a2b3c4d","pos":{"last":true},"elem":{"tag":"path"}},{"op":"set","id":"o1","attrs":{"fill":null}}]"#;
        let ops = Ops::parse(json, 10).unwrap();
        assert_eq!(ops.count(), 2);
        assert_eq!(ops.json(), json);
        assert_eq!(serde_json::to_string(&ops).unwrap(), json);
    }

    #[test]
    fn the_shape_is_checked_and_nothing_more() {
        for bad in [
            "{}",
            "\"add\"",
            "[1]",
            "[[]]",
            "[{}]",
            r#"[{"op":1}]"#,
            r#"[{"op":""}]"#,
            r#"[{"op":"Add"}]"#,
            r#"[{"op":"add","op":"remove"}]"#,
            r#"[{"op":"add"}] x"#,
            r#"[{"op":"add"},]"#,
        ] {
            assert!(
                matches!(Ops::parse(bad, 10), Err(OpsError::Shape(_))),
                "{bad}"
            );
        }
        assert_eq!(Ops::parse("[]", 10), Err(OpsError::Empty));
        // Un nome sconosciuto passa: lo rifiuta il motore della shell.
        assert!(Ops::parse(r#"[{"op":"teleport"}]"#, 10).is_ok());
        // Una chiave con escape si riconosce come `op`.
        assert!(Ops::parse(r#"[{"op":"add"}]"#, 10).is_ok());
        assert!(Ops::parse(r#"[{"op":"add","op":"set"}]"#, 10).is_err());
    }

    #[test]
    fn the_count_limit_stops_the_reading() {
        let json = format!("[{}]", [r#"{"op":"add"}"#; 11].join(","));
        assert_eq!(Ops::parse(&json, 11).unwrap().count(), 11);
        assert_eq!(
            Ops::parse(&json, 10),
            Err(OpsError::TooMany {
                count: 11,
                limit: 10
            })
        );
    }

    #[test]
    fn nesting_stops_at_the_depth_of_a_value() {
        // Come `serde_json`: al più 127 contenitori annidati. L'array e
        // l'operazione sono i primi due, e ne restano 125.
        let at = |levels: usize| {
            format!(
                r#"[{{"op":"add","x":{}{}}}]"#,
                "[".repeat(levels),
                "]".repeat(levels)
            )
        };
        assert!(Ops::parse(&at(MAX_DEPTH - 3), 10).is_ok());
        assert!(matches!(
            Ops::parse(&at(MAX_DEPTH - 2), 10),
            Err(OpsError::Shape(_))
        ));
        let objects = format!(
            r#"[{{"op":"add","x":{}1{}}}]"#,
            r#"{"a":"#.repeat(200),
            "}".repeat(200)
        );
        assert!(matches!(Ops::parse(&objects, 10), Err(OpsError::Shape(_))));
        // Il testo resta leggibile come `Value` fino al limite.
        let deepest = Ops::parse(&at(MAX_DEPTH - 3), 10).unwrap();
        assert!(serde_json::from_str::<serde_json::Value>(deepest.json()).is_ok());
        assert!(serde_json::from_str::<serde_json::Value>(&at(MAX_DEPTH - 2)).is_err());
    }
}
