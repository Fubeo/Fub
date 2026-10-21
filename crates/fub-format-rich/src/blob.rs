//! Ciò che la proiezione porta senza mostrarlo.
//!
//! Ogni nodo della proiezione porta con sé i dati originali che la superficie
//! non modifica — le proprietà di un tratto o di un paragrafo, un'immagine, una
//! sezione — come stringa opaca: JSON del modello di WordCraft in base64. La
//! shell non la legge e non la scrive; la copia così com'è quando il testo si
//! sposta, si spezza o si incolla.
//!
//! Che i dati viaggino col nodo, e non come indice in una tabella del
//! documento, è la scelta che tiene in piedi il salvataggio: dopo il primo
//! salvataggio la shell ha ancora il proprio buffer, mentre una tabella
//! ricostruita dal file nuovo avrebbe indici diversi. Un nodo che porta i
//! propri dati non può diventare vecchio, e un tratto incollato da un altro
//! documento porta la propria formattazione invece di quella di un indice
//! omonimo.
//!
//! Questi dati viaggiano dentro bozze autorevoli, che un Fub più vecchio o più
//! nuovo può rileggere. La loro grammatica ha un numero, [`OPAQUE_SCHEMA`],
//! che la proiezione dichiara (`opaque_schema`); e ogni lettura controlla che
//! il dato decodificato, riscritto, contenga ancora tutto ciò che il testo
//! diceva ([`contains`]): un campo che serde ignorerebbe perché sconosciuto
//! rifiuta il dato invece di sparire in silenzio.

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use crate::RichError;

/// Lo schema dei dati opachi che questo Fub scrive. Si incrementa quando
/// cambia la forma serializzata di uno dei tipi che vi si codificano (i tipi
/// del modello di WordCraft e i `*Keep`/`*Key` di Fub); lo tiene d'occhio
/// `tests/opaque_schema.rs`. Lo schema 0 è quello implicito della proiezione
/// di versione 1, e ha la stessa forma dello schema 1.
pub const OPAQUE_SCHEMA: u32 = 1;

/// Se questo Fub legge i dati opachi dello schema `schema`. Uno schema più
/// vecchio con una forma diversa avrà la sua migrazione esplicita, qui.
pub(crate) fn readable(schema: u32) -> bool {
    schema == 0 || schema == OPAQUE_SCHEMA
}

pub(crate) fn encode<T: Serialize>(value: &T) -> Result<String, RichError> {
    let json = serde_json::to_vec(value).map_err(|error| RichError::Codec(error.to_string()))?;
    Ok(STANDARD_NO_PAD.encode(json))
}

pub(crate) fn decode<T: DeserializeOwned + Serialize>(blob: &str) -> Result<T, RichError> {
    let malformed =
        |error: &dyn std::fmt::Display| RichError::Malformed(format!("opaque data: {error}"));
    let json = STANDARD_NO_PAD
        .decode(blob)
        .map_err(|error| malformed(&error))?;
    let value: T = serde_json::from_slice(&json).map_err(|error| malformed(&error))?;
    // I due lati passano dal testo: un `f32` portato in `Value` senza testo
    // diventerebbe un altro numero.
    let written: Value = serde_json::from_slice(&json).map_err(|error| malformed(&error))?;
    let again = serde_json::to_vec(&value).map_err(|error| malformed(&error))?;
    let again: Value = serde_json::from_slice(&again).map_err(|error| malformed(&error))?;
    if !contains(&again, &written) {
        return Err(malformed(&"a field would be lost"));
    }
    Ok(value)
}

/// Se `whole` contiene `part`: ogni chiave di un oggetto di `part` c'è in
/// `whole` con un valore che la contiene, gli array hanno la stessa lunghezza
/// e si confrontano elemento per elemento, il resto è uguale. «Contenuto» e
/// non «uguale»: un campo che il tipo scrive in più con il suo valore
/// predefinito non è una perdita. Per lo stesso motivo una chiave di `part`
/// che vale `null`, `[]` o `{}` può mancare in `whole`: il tipo la omette
/// quando è vuota, e non porta niente.
pub(crate) fn contains(whole: &Value, part: &Value) -> bool {
    match (whole, part) {
        (Value::Object(whole), Value::Object(part)) => {
            part.iter().all(|(key, value)| match whole.get(key) {
                Some(w) => contains(w, value),
                None => empty(value),
            })
        }
        (Value::Array(whole), Value::Array(part)) => {
            whole.len() == part.len() && whole.iter().zip(part).all(|(w, p)| contains(w, p))
        }
        (whole, part) => whole == part,
    }
}

fn empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(items) => items.is_empty(),
        Value::Object(fields) => fields.is_empty(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wordcraft_doc::CharProps;

    #[test]
    fn una_proprietà_torna_identica() {
        let props = CharProps {
            font: Some("Calibri".into()),
            size: Some(10.5),
            bold: Some(false),
            lang: Some("it-IT".into()),
            ..CharProps::default()
        };
        let back: CharProps = decode(&encode(&props).unwrap()).unwrap();
        assert_eq!(back, props);
    }

    #[test]
    fn un_campo_sconosciuto_non_si_perde_in_silenzio() {
        let json = br#"{"font":"Calibri","size":10.5,"kerning_nuovo":3}"#;
        assert!(
            serde_json::from_slice::<CharProps>(json).is_ok(),
            "serde lo ignorerebbe"
        );
        assert!(matches!(
            decode::<CharProps>(&STANDARD_NO_PAD.encode(json)),
            Err(RichError::Malformed(_))
        ));
        // Lo stesso dato senza il campo sconosciuto si legge.
        let json = br#"{"font":"Calibri","size":10.5}"#;
        let props: CharProps = decode(&STANDARD_NO_PAD.encode(json)).unwrap();
        assert_eq!(props.size, Some(10.5));
    }

    #[test]
    fn il_contenimento_guarda_chiavi_e_array() {
        use serde_json::json;
        assert!(contains(
            &json!({"a": 1, "b": [1, {"c": 2, "d": 3}]}),
            &json!({"b": [1, {"c": 2}]})
        ));
        assert!(!contains(&json!({"a": 1}), &json!({"a": 2})));
        assert!(!contains(&json!({"a": [1, 2]}), &json!({"a": [1]})));
        // Una chiave vuota può mancare, una con un valore no.
        assert!(contains(
            &json!({"a": 1}),
            &json!({"b": null, "c": [], "d": {}})
        ));
        assert!(!contains(&json!({"a": 1}), &json!({"b": false})));
        assert!(!contains(&json!({"a": 1}), &json!({"b": [0]})));
        assert!(contains(&json!(0.1), &json!(0.1)));
    }

    #[test]
    fn un_dato_rovinato_è_un_errore_tipizzato() {
        assert!(matches!(
            decode::<CharProps>("@@"),
            Err(RichError::Malformed(_))
        ));
        assert!(matches!(
            decode::<CharProps>(&STANDARD_NO_PAD.encode(b"[1,2]")),
            Err(RichError::Malformed(_))
        ));
    }
}
