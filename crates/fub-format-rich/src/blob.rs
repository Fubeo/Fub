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
//! diceva ([`gaps`]): un campo che serde ignorerebbe perché sconosciuto
//! rifiuta il dato invece di sparire in silenzio, anche quando vale `null`,
//! `[]` o `{}` e anche dentro un enum con il tag interno, dove serde non dice
//! che cosa ignora.

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use crate::RichError;

/// Lo schema dei dati opachi che questo Fub scrive. Si incrementa quando
/// cambia la forma serializzata di uno dei tipi che vi si codificano (i tipi
/// del modello di WordCraft e i `*Keep`/`*Key` di Fub); lo tiene d'occhio
/// `tests/opaque_schema.rs`. Gli schemi:
///
/// - 0: quello implicito della proiezione di versione 1, con la forma dell'1;
/// - 1: il primo dichiarato (WordCraft 0.7);
/// - 2: le proprietà del carattere hanno in più `eastAsianLayout` (WordCraft
///   0.9), facoltativo.
pub const OPAQUE_SCHEMA: u32 = 2;

/// Se questo Fub legge i dati opachi dello schema `schema`. Ogni schema
/// precedente ha qui il suo braccio, con il perché: alzare [`OPAQUE_SCHEMA`]
/// lascia fuori lo schema che era corrente, finché qualcuno non dice come si
/// legge (`tests/opaque_schema.rs` lo pretende, con la sua bozza).
pub(crate) fn readable(schema: u32) -> bool {
    match schema {
        // Lo 0 e l'1 hanno la forma del 2 senza `eastAsianLayout`, che è
        // facoltativo: in un loro dato manca e vale assente.
        0 | 1 => true,
        OPAQUE_SCHEMA => true,
        _ => false,
    }
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
    let written: Value = serde_json::from_slice(&json).map_err(|error| malformed(&error))?;
    let again = rewritten(&value).map_err(|error| malformed(&error))?;
    let mut missing = Vec::new();
    if !gaps(&again, &written, "", &mut missing) {
        return Err(malformed(&"a field would be lost"));
    }
    // Una chiave vuota che la riscrittura omette è un campo che il tipo
    // conosce e non scrive quando è vuoto, oppure un campo che non conosce.
    // Lo dice il tipo stesso: con un altro valore, un campo conosciuto cambia
    // il dato o non si legge più; uno sconosciuto resta ignorato.
    for pointer in missing {
        let mut probe = written.clone();
        if let Some(slot) = probe.pointer_mut(&pointer) {
            *slot = Value::Bool(true);
        }
        let ignored = serde_json::from_value::<T>(probe)
            .ok()
            .and_then(|other| rewritten(&other).ok())
            .is_some_and(|other| other == again);
        if ignored {
            return Err(malformed(&format!("unknown field {pointer}")));
        }
    }
    Ok(value)
}

/// Il dato riscritto, passando dal testo: un `f32` portato in `Value` senza
/// testo diventerebbe un altro numero.
fn rewritten<T: Serialize>(value: &T) -> serde_json::Result<Value> {
    serde_json::from_slice(&serde_json::to_vec(value)?)
}

/// Se `whole` contiene `part`: ogni chiave di un oggetto di `part` c'è in
/// `whole` con un valore che la contiene, gli array hanno la stessa lunghezza
/// e si confrontano elemento per elemento, il resto è uguale. «Contenuto» e
/// non «uguale»: un campo che il tipo scrive in più con il suo valore
/// predefinito non è una perdita. Una chiave di `part` che vale `null`, `[]` o
/// `{}` e manca in `whole` non decide da sola: finisce in `missing`, come
/// puntatore JSON, e la decide [`decode`].
pub(crate) fn gaps(whole: &Value, part: &Value, at: &str, missing: &mut Vec<String>) -> bool {
    match (whole, part) {
        (Value::Object(whole), Value::Object(part)) => part.iter().all(|(key, value)| {
            let at = format!("{at}/{}", key.replace('~', "~0").replace('/', "~1"));
            match whole.get(key) {
                Some(w) => gaps(w, value, &at, missing),
                None if empty(value) => {
                    missing.push(at);
                    true
                }
                None => false,
            }
        }),
        (Value::Array(whole), Value::Array(part)) => {
            whole.len() == part.len()
                && whole
                    .iter()
                    .zip(part)
                    .enumerate()
                    .all(|(i, (w, p))| gaps(w, p, &format!("{at}/{i}"), missing))
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
        let contains = |whole: &Value, part: &Value| {
            let mut missing = Vec::new();
            gaps(whole, part, "", &mut missing).then_some(missing)
        };
        assert_eq!(
            contains(
                &json!({"a": 1, "b": [1, {"c": 2, "d": 3}]}),
                &json!({"b": [1, {"c": 2}]})
            ),
            Some(vec![])
        );
        assert_eq!(contains(&json!({"a": 1}), &json!({"a": 2})), None);
        assert_eq!(contains(&json!({"a": [1, 2]}), &json!({"a": [1]})), None);
        // Una chiave vuota che manca resta da decidere, una con un valore no.
        assert_eq!(
            contains(
                &json!({"a": 1, "e": [{}]}),
                &json!({"b": null, "c/d": [], "e": [{"f": {}}]})
            ),
            Some(vec!["/b".into(), "/c~1d".into(), "/e/0/f".into()])
        );
        assert_eq!(contains(&json!({"a": 1}), &json!({"b": false})), None);
        assert_eq!(contains(&json!({"a": 1}), &json!({"b": [0]})), None);
        assert_eq!(contains(&json!(0.1), &json!(0.1)), Some(vec![]));
    }

    #[test]
    fn un_campo_conosciuto_vuoto_si_legge_e_uno_sconosciuto_no() {
        use wordcraft_doc::InlineObject;
        let read = |json: &str| decode::<InlineObject>(&STANDARD_NO_PAD.encode(json));
        let image = r#""type":"image","media":"m","w":1.0,"h":2.0"#;
        // Il tipo omette `ole` quando manca: scritto `null`, non porta niente.
        let ole = read(&format!("{{{image},\"ole\":null}}"));
        assert!(ole.is_ok(), "{ole:?}");
        // Un campo sconosciuto vuoto, che serde ignorerebbe senza dirlo
        // perché il tag dell'enum è interno.
        for unknown in [r#""nuovo":{}"#, r#""nuovo":[]"#, r#""nuovo":null"#] {
            assert!(
                matches!(
                    read(&format!("{{{image},{unknown}}}")),
                    Err(RichError::Malformed(_))
                ),
                "{unknown}"
            );
        }
        // E più in fondo, dentro un campo conosciuto.
        let float = r#""float":{"wrap":"inline","nuovo":{}}"#;
        assert!(serde_json::from_str::<InlineObject>(&format!("{{{image},{float}}}")).is_ok());
        assert!(matches!(
            read(&format!("{{{image},{float}}}")),
            Err(RichError::Malformed(_))
        ));
        let props = |json: &str| decode::<CharProps>(&STANDARD_NO_PAD.encode(json));
        assert!(props(r#"{"font":null,"size":10.0}"#).is_ok());
        assert!(matches!(
            props(r#"{"size":10.0,"nuovo":{}}"#),
            Err(RichError::Malformed(_))
        ));
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
