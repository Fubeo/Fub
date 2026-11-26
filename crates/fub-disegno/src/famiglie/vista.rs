//! La famiglia `vista` della mappa: il suo stato, vuoto finché il task della
//! famiglia non lo riempie (`docs/architecture/disegno-completo.md`).
//!
//! La modalità di disegno (`view.drawMode`, K6 T11) sta nella sessione del motore, non nel file: cambiare
//! modo non cambia il disegno, e il comando dà il modo come lettura. Il modo «dentro» non si fa ancora:
//! crea un gruppo di ritaglio intorno al tracciato, che la differenza generica del file non scrive (la
//! causa è in `docs/product/drawing-masks.md`). Un comando senza modo, che nel motore gira i modi, si
//! rifiuta prima: non deve finire su «dentro» senza volerlo. Il perché (provato in ricerca): dopo «dentro»
//! il passo del motore che crea il nuovo oggetto nel gruppo di ritaglio dà `unsupported` dalla differenza
//! generica del file, e il disegno non cambia.

use std::sync::Arc;

use fub_abi::PluginError;
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;

use super::StatoFamiglia;
use crate::apertura::Copia;

/// Il comando che sceglie la modalità di disegno (K6 T11).
const MODO_DI_DISEGNO: &str = "view.drawMode";

/// Lo stato della famiglia: non tiene niente.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        0
    }

    fn libera(&self) -> u64 {
        0
    }

    /// Il modo di disegno è della sessione: cambiarlo è una lettura, niente passo.
    fn legge(&self, id: &str) -> bool {
        id == MODO_DI_DISEGNO
    }

    /// Solo `normal` e `behind` si fanno; il resto si dice prima del motore, in italiano.
    fn argomenti_della_copia(id: &str, _copia: &Copia, _selezione: &[String], valore: Value) -> Result<Value, PluginError> {
        if id != MODO_DI_DISEGNO {
            return Ok(valore);
        }
        match valore.get("mode").and_then(Value::as_str) {
            Some("normal") | Some("behind") => Ok(valore),
            Some("inside") => Err(PluginError::BadArgs(
                "Il modo Dentro non c'è ancora: il file non tiene il gruppo di ritaglio che il motore ne fa.".into(),
            )),
            Some(_) => Err(PluginError::BadArgs("Il modo è normal o behind.".into())),
            None => Err(PluginError::BadArgs("Scegli il modo: normale o dietro.".into())),
        }
    }
}
