//! La famiglia `trame` della mappa: la Pittura dinamica di VectorCraft
//! (`livePaint.*`, `vendor/vectorcraft/crates/engine/src/cmd/buildcmds/live_paint.rs`).
//! Lo stato non tiene niente; la famiglia traduce il gruppo che i comandi
//! vogliono (`group`) dall'id del file al nodo del motore.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;
use vectorcraft_doc::NodeId;
use vectorcraft_tools::builder::is_live_paint;

use super::{nodi_scelti, selezione_spenta, StatoFamiglia};
use crate::apertura::Copia;

/// I comandi che lavorano su un gruppo della Pittura dinamica dato come
/// `group`: Riempi lo prende anche dalla selezione (se non c'è, fa vivi i
/// tracciati scelti), Bordo e Info lo vogliono.
const COL_GRUPPO: [&str; 3] = ["livePaint.fill", "livePaint.strokeEdge", "livePaint.info"];

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

    /// Come in VectorCraft: i comandi del menu vogliono una selezione; Unisci,
    /// Rilascia, Espandi e le Opzioni aperture vogliono un gruppo vivo fra
    /// gli oggetti scelti. Un oggetto scelto che il motore non ha, o bloccato,
    /// spegne ogni comando; una copia di sola lettura spegne quelli che
    /// cambiano il disegno.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        let del_menu = matches!(
            id,
            "livePaint.make"
                | "livePaint.merge"
                | "livePaint.release"
                | "livePaint.expand"
                | "livePaint.gapOptions"
        );
        if del_menu && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if let Some(r) = selezione_spenta(copia, selezione) {
            return Some(r);
        }
        if id != "livePaint.info" && !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        let vuole_il_gruppo = del_menu && id != "livePaint.make";
        (vuole_il_gruppo && gruppo_scelto(copia, selezione).is_none())
            .then_some(DrawingDisabledReason::NeedsGroup)
    }

    /// Bordo e Info senza un gruppo della Pittura dinamica, né dato né
    /// scelto: `empty`, prima del motore.
    fn rifiuto_valore(
        id: &str,
        copia: &Copia,
        selezione: &[String],
        valore: &Value,
    ) -> Option<DrawingRefusal> {
        if !matches!(id, "livePaint.strokeEdge" | "livePaint.info") {
            return None;
        }
        let dato = valore.get("group").is_some_and(|g| !g.is_null())
            || (id == "livePaint.info" && valore.get("id").is_some_and(|g| !g.is_null()));
        (!dato && gruppo_scelto(copia, selezione).is_none()).then_some(DrawingRefusal::Empty)
    }

    /// Info dà i nodi del motore: il gruppo, le facce e i bordi tornano con
    /// l'id del file, `null` se non ne hanno uno (un bordo che la scena tiene
    /// estraneo).
    fn lettura(&self, id: &str, copia: &Copia, mut risultato: Value) -> Value {
        if id != "livePaint.info" {
            return risultato;
        }
        let del_file = |v: &Value| -> Value {
            v.as_u64()
                .and_then(|n| copia.mappa.del_nodo(NodeId(n)))
                .and_then(|i| copia.mappa.elemento(i))
                .and_then(|e| e.id_del_file())
                .map_or(Value::Null, Value::from)
        };
        if let Some(g) = risultato.get("id").map(del_file) {
            risultato["id"] = g;
        }
        for chiave in ["faces", "edges"] {
            if let Some(pezzi) = risultato.get_mut(chiave).and_then(Value::as_array_mut) {
                for p in pezzi {
                    if let Some(v) = p.get("id").map(del_file) {
                        p["id"] = v;
                    }
                }
            }
        }
        risultato
    }

    /// `group` come id del file diventa il nodo del motore; senza `group`, il
    /// primo gruppo della Pittura dinamica fra gli oggetti scelti.
    fn argomenti_della_copia(
        id: &str,
        copia: &Copia,
        selezione: &[String],
        mut valore: Value,
    ) -> Result<Value, PluginError> {
        if !COL_GRUPPO.contains(&id) {
            return Ok(valore);
        }
        let gruppo = match valore.get("group") {
            Some(Value::String(file)) => {
                let nodo = nodi_scelti(copia, std::slice::from_ref(file))
                    .ok()
                    .and_then(|n| n.first().copied())
                    .filter(|n| copia.documento.node(*n).is_some_and(is_live_paint))
                    .ok_or_else(|| {
                        PluginError::BadArgs(
                            format!("«{file}» non è un gruppo della Pittura dinamica.").into(),
                        )
                    })?;
                Some(nodo)
            }
            Some(v) if !v.is_null() => return Ok(valore),
            _ => gruppo_scelto(copia, selezione),
        };
        if let Some(g) = gruppo {
            if !valore.is_object() {
                valore = Value::Object(serde_json::Map::new());
            }
            if let Some(o) = valore.as_object_mut() {
                o.insert("group".into(), Value::from(g.0));
            }
        }
        Ok(valore)
    }
}

/// Il primo gruppo della Pittura dinamica fra gli oggetti scelti.
fn gruppo_scelto(copia: &Copia, selezione: &[String]) -> Option<NodeId> {
    nodi_scelti(copia, selezione)
        .ok()?
        .into_iter()
        .find(|n| copia.documento.node(*n).is_some_and(is_live_paint))
}
