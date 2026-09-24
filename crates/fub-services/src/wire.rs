//! # Wire `u64`-come-stringhe (P16/P17, Main)
//!
//! Contatori, versioni, cursori e timestamp u64 che sono identità/revisioni
//! attraversano il JSON come STRINGHE decimali: oltre 2^53 un `number` JS
//! perde bit in silenzio (vedi `fub_abi::ipc::u64_string`). In lettura si
//! accetta anche il numero (dati pre-regola / client non migrati), mai
//! l'errore silenzioso: spazzatura = errore. I tipi Rust restano `u64`/`u32`/
//! `usize`: cambia solo la forma sul wire. Nessuna dipendenza da `fub-abi`
//! qui (il server resta fuori dal grafo host/kernel/ABI per decisione Main):
//! la conformità è byte-identica per costruzione, provata dal test `u64::MAX`.

use serde::{Deserialize, Deserializer, Serializer};

/// Un `u64` sul wire: già stringa (la regola) o ancora numero (compat).
#[derive(Deserialize)]
#[serde(untagged)]
enum NumberOrString {
    Number(u64),
    String(String),
}

impl NumberOrString {
    fn parse(self) -> Result<u64, std::num::ParseIntError> {
        match self {
            NumberOrString::Number(n) => Ok(n),
            NumberOrString::String(s) => s.trim().parse(),
        }
    }
}

/// `#[serde(with = "crate::wire::u64_string")]` per un `u64` identità/revisione.
pub mod u64_string {
    use super::*;

    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(v)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        NumberOrString::deserialize(d)
            .map_err(serde::de::Error::custom)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

/// `Option<u64>` identità/revisione (assente = `None`, mai zero inventato).
pub mod opt_u64_string {
    use super::*;

    pub fn serialize<S: Serializer>(v: &Option<u64>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(n) => s.collect_str(n),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
        let opt: Option<NumberOrString> = Deserialize::deserialize(d)?;
        match opt {
            None => Ok(None),
            Some(v) => v.parse().map(Some).map_err(serde::de::Error::custom),
        }
    }
}

/// `Vec<u64>` versioni/cursori: ogni elemento come stringa.
pub mod vec_u64_string {
    use super::*;

    pub fn serialize<S: Serializer>(v: &[u64], s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let mut seq = s.serialize_seq(Some(v.len()))?;
        for n in v {
            seq.serialize_element(&n.to_string())?;
        }
        seq.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u64>, D::Error> {
        let raw: Vec<NumberOrString> = Deserialize::deserialize(d)?;
        raw.into_iter()
            .map(|v| v.parse().map_err(serde::de::Error::custom))
            .collect()
    }
}

/// `BTreeMap<String, u64>` vettori di versione: valori come stringhe, chiavi
/// in ordine (il `BTreeMap` itera già ordinato).
pub mod vv_string {
    use super::*;
    use std::collections::BTreeMap;

    pub fn serialize<S: Serializer>(v: &BTreeMap<String, u64>, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(Some(v.len()))?;
        for (k, n) in v {
            map.serialize_entry(k, &n.to_string())?;
        }
        map.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<BTreeMap<String, u64>, D::Error> {
        let raw: BTreeMap<String, NumberOrString> = Deserialize::deserialize(d)?;
        raw.into_iter()
            .map(|(k, v)| {
                v.parse()
                    .map(Some)
                    .map_err(serde::de::Error::custom)
                    .map(|n| (k, n.unwrap()))
            })
            .collect()
    }
}

/// `usize` conteggi piccoli (docs/pending/page_count): restano numeri sul
/// wire — non sono identità e non superano 2^53. Nessun helper: documentato
/// qui per dire che l'esclusione è una scelta, non una dimenticanza.
#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Sample {
        #[serde(with = "u64_string")]
        counter: u64,
        #[serde(with = "vv_string")]
        vv: std::collections::BTreeMap<String, u64>,
        #[serde(with = "vec_u64_string")]
        versions: Vec<u64>,
        #[serde(with = "opt_u64_string", default)]
        live: Option<u64>,
    }

    #[test]
    fn full_width_u64_survives_as_string() {
        // NOTA: test preparato, Main lo esegue dopo il freeze (regola
        // concorrenza: nessun agente lancia build/test mid-flight).
        let mut vv = std::collections::BTreeMap::new();
        vv.insert("r".to_string(), u64::MAX);
        let v = Sample {
            counter: u64::MAX,
            vv,
            versions: vec![1, u64::MAX],
            live: Some(u64::MAX),
        };
        let json = serde_json::to_string(&v).unwrap();
        assert!(
            json.contains(&format!("\"{}\"", u64::MAX)),
            "u64 viaggia come stringa: {json}"
        );
        assert_eq!(serde_json::from_str::<Sample>(&json).unwrap(), v);
        // Compat lettura: il numero nudo resta leggibile (dati pre-regola).
        let old: Sample =
            serde_json::from_str(r#"{"counter": 7, "vv": {"r": 7}, "versions": [7], "live": 7}"#)
                .unwrap();
        assert_eq!(old.counter, 7);
        // Spazzatura = errore, mai zero.
        assert!(
            serde_json::from_str::<Sample>(r#"{"counter": "x", "vv": {}, "versions": []}"#)
                .is_err()
        );
    }
}
