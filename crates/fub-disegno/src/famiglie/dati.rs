//! La famiglia `dati` della mappa: per ora la lettura degli Attributi
//! (`attributes.info`), che la sezione «Attributi» del Design usa per la
//! regola di riempimento (`docs/architecture/disegno-completo.md`).

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;
use vectorcraft_doc::NodeId;

use super::{selezione_spenta, StatoFamiglia};
use crate::apertura::Copia;

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

    /// La lettura degli Attributi vuole oggetti che il motore ha: un pezzo
    /// non mappato la spegne, come gli altri comandi sulla selezione.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if id != "attributes.info" {
            return None;
        }
        selezione_spenta(copia, selezione)
    }

    /// Gli `ids` della lettura degli Attributi sono nodi del motore: tornano
    /// con l'id del file, `null` per un nodo che il file non ha.
    fn lettura(&self, id: &str, copia: &Copia, mut risultato: Value) -> Value {
        if id != "attributes.info" {
            return risultato;
        }
        if let Some(ids) = risultato.get_mut("ids").and_then(Value::as_array_mut) {
            for n in ids {
                *n = n
                    .as_u64()
                    .and_then(|n| copia.mappa.del_nodo(NodeId(n)))
                    .and_then(|i| copia.mappa.elemento(i))
                    .and_then(|e| e.id_del_file())
                    .map_or(Value::Null, Value::from);
            }
        }
        risultato
    }

    /// La lettura degli Attributi vale sempre sugli oggetti scelti: gli id del
    /// motore (`ids`, `id`, `item`) non arrivano da fuori.
    fn argomenti_della_copia(
        id: &str,
        _copia: &Copia,
        _selezione: &[String],
        mut valore: Value,
    ) -> Result<Value, PluginError> {
        if id == "attributes.info" {
            if let Some(o) = valore.as_object_mut() {
                for chiave in ["ids", "id", "item"] {
                    o.remove(chiave);
                }
            }
        }
        Ok(valore)
    }
}
