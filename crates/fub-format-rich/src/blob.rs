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

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::RichError;

pub(crate) fn encode<T: Serialize>(value: &T) -> Result<String, RichError> {
    let json = serde_json::to_vec(value).map_err(|error| RichError::Codec(error.to_string()))?;
    Ok(STANDARD_NO_PAD.encode(json))
}

pub(crate) fn decode<T: DeserializeOwned>(blob: &str) -> Result<T, RichError> {
    let json = STANDARD_NO_PAD
        .decode(blob)
        .map_err(|error| RichError::Malformed(format!("opaque data: {error}")))?;
    serde_json::from_slice(&json)
        .map_err(|error| RichError::Malformed(format!("opaque data: {error}")))
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
