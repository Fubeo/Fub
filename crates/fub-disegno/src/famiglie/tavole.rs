//! La famiglia `tavole` della mappa: le tavole (lo strumento `artboard`, che
//! non vuole un ponte) e la Quota di VectorCraft (`dimension.*`,
//! `vendor/vectorcraft/crates/engine/src/cmd/dimension.rs`). Lo stato non
//! tiene niente; la famiglia traduce le quote (`ids`, `id`) e gli oggetti
//! misurati (`source`) dall'id del file al nodo del motore.
//!
//! Il legame di una quota con l'oggetto che misura vive solo nel gesto: la
//! ricetta lo toglie quando punta fuori dalla quota (`ricetta::codifica`),
//! perché gli id del motore si rinumerano a ogni lettura del file.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;
use vectorcraft_doc::NodeId;

use super::{nodi_scelti, selezione_spenta, StatoFamiglia};
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

    /// Come in VectorCraft: Aggiorna vuole solo quote fra gli oggetti scelti,
    /// Applica a tutti una quota scelta. Un oggetto scelto che il motore non
    /// ha, o bloccato, spegne ogni comando; una copia di sola lettura spegne
    /// quelli che cambiano il disegno.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if !id.starts_with("dimension.") {
            return None;
        }
        let sulle_quote = id == "dimension.update" || id == "dimension.applyToAll";
        if sulle_quote && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if let Some(r) = selezione_spenta(copia, selezione) {
            return Some(r);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        let nodi = nodi_scelti(copia, selezione).unwrap_or_default();
        let senza = match id {
            "dimension.update" => !nodi.iter().all(|n| e_quota(copia, *n)),
            "dimension.applyToAll" => !nodi.iter().any(|n| e_quota(copia, *n)),
            _ => false,
        };
        senza.then(|| DrawingDisabledReason::Other {
            text: "Seleziona una quota.".into(),
        })
    }

    /// Gli `ids` di Aggiorna, l'`id` di Applica a tutti e i nodi della
    /// sorgente di Crea (`source`: `edge`, `first`, `second`, `a`, `b`,
    /// `vertex` coi loro `node`, o `node` per un cerchio), come id del file,
    /// diventano nodi del motore.
    fn argomenti_della_copia(
        id: &str,
        copia: &Copia,
        _selezione: &[String],
        mut valore: Value,
    ) -> Result<Value, PluginError> {
        match id {
            "dimension.update" => {
                if let Some(ids) = valore.get_mut("ids").and_then(Value::as_array_mut) {
                    for id in ids {
                        if let Some(file) = id.as_str() {
                            *id = Value::from(nodo_del_file(copia, file)?.0);
                        }
                    }
                }
            }
            "dimension.applyToAll" => {
                if let Some(file) = valore.get("id").and_then(Value::as_str).map(str::to_string) {
                    valore["id"] = Value::from(nodo_del_file(copia, &file)?.0);
                }
            }
            "dimension.create" => {
                if let Some(sorgente) = valore.get_mut("source").and_then(Value::as_object_mut) {
                    for chiave in ["edge", "first", "second", "a", "b", "vertex"] {
                        if let Some(r) = sorgente.get_mut(chiave) {
                            nodo_nel_riferimento(copia, r)?;
                        }
                    }
                    if let Some(file) = sorgente.get("node").and_then(Value::as_str).map(str::to_string) {
                        sorgente.insert("node".into(), Value::from(nodo_del_file(copia, &file)?.0));
                    }
                }
            }
            _ => {}
        }
        Ok(valore)
    }
}

/// Il `node` di un riferimento a un lato o a un punto, come id del file,
/// diventa il nodo del motore.
fn nodo_nel_riferimento(copia: &Copia, r: &mut Value) -> Result<(), PluginError> {
    if let Some(file) = r.get("node").and_then(Value::as_str).map(str::to_string) {
        r["node"] = Value::from(nodo_del_file(copia, &file)?.0);
    }
    Ok(())
}

/// L'id del file `file` come nodo del motore, o l'argomento che non lo è.
fn nodo_del_file(copia: &Copia, file: &str) -> Result<NodeId, PluginError> {
    nodi_scelti(copia, &[file.to_string()])
        .ok()
        .and_then(|n| n.first().copied())
        .ok_or_else(|| PluginError::BadArgs(format!("«{file}» non è nel disegno.").into()))
}

/// Vero se il nodo `n` è una quota.
fn e_quota(copia: &Copia, n: NodeId) -> bool {
    copia
        .documento
        .node(n)
        .is_some_and(|n| n.extras().dimension.is_some())
}
