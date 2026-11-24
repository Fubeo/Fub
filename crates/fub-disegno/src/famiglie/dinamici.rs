//! La famiglia `dinamici` della mappa: la Fusione di VectorCraft
//! (`object.blend.*`, `vendor/vectorcraft/crates/engine/src/cmd/live/blend.rs`)
//! e gli Oggetti sul tracciato (`object.objectsOnPath.*`,
//! `engine/src/cmd/objects_on_path.rs`). Lo stato non tiene niente; la
//! famiglia traduce gli oggetti di Crea e di Attacca (`ids`), il tracciato di
//! Attacca (`path`) e la fusione dei comandi sul dorso (`id`) dall'id del file
//! al nodo del motore, e rende Info con gli id del file.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;
use vectorcraft_doc::objects_on_path::is_objects_on_path;
use vectorcraft_doc::{NodeId, NodeKind};

use super::{nodi_scelti, selezione_spenta, StatoFamiglia};
use crate::apertura::Copia;

/// I comandi del menu che lavorano sulle fusioni scelte: senza una fusione
/// fra gli oggetti scelti il motore non fa niente.
const SULLA_FUSIONE: [&str; 5] = [
    "object.blend.release",
    "object.blend.expand",
    "object.blend.replaceSpine",
    "object.blend.reverseSpine",
    "object.blend.reverseFrontToBack",
];

/// I comandi sul dorso di una fusione data come `id` (senza, la prima
/// fusione scelta).
const SUL_DORSO: [&str; 5] = [
    "object.blend.spine.moveAnchor",
    "object.blend.spine.convertAnchor",
    "object.blend.spine.reshapeSegment",
    "object.blend.spine.addAnchor",
    "object.blend.spine.removeAnchor",
];

/// I comandi degli Oggetti sul tracciato che lavorano sui gruppi scelti (o
/// su quelli attorno agli oggetti scelti).
const SUI_GRUPPI: [&str; 2] = [
    "object.objectsOnPath.options",
    "object.objectsOnPath.expand",
];

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

    /// Le Opzioni senza una fusione scelta cambiano solo le preferenze delle
    /// fusioni nuove (che il disegno salva): il documento resta com'è, e non
    /// è un comando vuoto.
    fn legge(&self, id: &str) -> bool {
        id == "object.blend.options"
    }

    /// Come in VectorCraft: Crea vuole almeno due oggetti scelti; Rilascia,
    /// Espandi, Sostituisci dorso, Inverti dorso e Inverti avanti/dietro una
    /// fusione fra gli oggetti scelti (Sostituisci anche un tracciato). Le
    /// Opzioni sono sempre accese: senza una fusione scelta cambiano quelle
    /// delle fusioni nuove. Un oggetto scelto che il motore non ha, o
    /// bloccato, spegne ogni comando; una copia di sola lettura spegne quelli
    /// che cambiano il disegno.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        let sulla_fusione = SULLA_FUSIONE.contains(&id);
        if (id == "object.blend.make" || sulla_fusione) && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if let Some(r) = selezione_spenta(copia, selezione) {
            return Some(r);
        }
        if id != "object.blend.info" && !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        if id == "object.blend.make" && selezione.len() < 2 {
            return Some(DrawingDisabledReason::Other {
                text: "Seleziona almeno due oggetti.".into(),
            });
        }
        if sulla_fusione && fusione_scelta(copia, selezione).is_none() {
            return Some(DrawingDisabledReason::Other {
                text: "Seleziona una fusione.".into(),
            });
        }
        // Attacca vuole gli oggetti da attaccare (il tracciato lo dà il clic
        // dello strumento, o `path`); Opzioni ed Espandi un gruppo degli
        // Oggetti sul tracciato fra gli oggetti scelti o attorno a uno.
        if id == "object.objectsOnPath.attach" && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if SUI_GRUPPI.contains(&id) && gruppo_sul_tracciato(copia, selezione).is_none() {
            return Some(DrawingDisabledReason::Other {
                text: "Seleziona un gruppo di oggetti sul tracciato.".into(),
            });
        }
        if id == "object.blend.replaceSpine" && !con_un_tracciato(copia, selezione) {
            return Some(DrawingDisabledReason::Other {
                text: "Seleziona una fusione e un tracciato.".into(),
            });
        }
        None
    }

    /// Info dà i nodi del motore: la fusione e i suoi oggetti chiave tornano
    /// con l'id del file, `null` se non ne hanno uno (le chiavi stanno nella
    /// ricetta della fusione, non sono elementi del file).
    fn lettura(&self, id: &str, copia: &Copia, mut risultato: Value) -> Value {
        if id != "object.blend.info" {
            return risultato;
        }
        let del_file = |v: &Value| -> Value {
            v.as_u64()
                .and_then(|n| copia.mappa.del_nodo(NodeId(n)))
                .and_then(|i| copia.mappa.elemento(i))
                .and_then(|e| e.id_del_file())
                .map_or(Value::Null, Value::from)
        };
        if let Some(f) = risultato.get("id").map(del_file) {
            risultato["id"] = f;
        }
        if let Some(chiavi) = risultato.get_mut("keys").and_then(Value::as_array_mut) {
            for k in chiavi {
                *k = del_file(k);
            }
        }
        risultato
    }

    /// Gli `ids` di Crea e l'`id` dei comandi sul dorso, come id del file,
    /// diventano nodi del motore; senza `id`, la prima fusione scelta. Le
    /// Opzioni senza una fusione scelta lasciano l'andamento, la rampa e lo
    /// spostamento del colore (sono di ogni fusione, non delle nuove: il
    /// motore li rifiuterebbe), come la finestra di VectorCraft che li spegne.
    fn argomenti_della_copia(
        id: &str,
        copia: &Copia,
        selezione: &[String],
        mut valore: Value,
    ) -> Result<Value, PluginError> {
        if id == "object.blend.options" {
            if fusione_scelta(copia, selezione).is_none() {
                if let Some(o) = valore.as_object_mut() {
                    for chiave in ["easingType", "ramp", "colorShift"] {
                        o.remove(chiave);
                    }
                }
            }
            return Ok(valore);
        }
        if id == "object.objectsOnPath.attach" {
            if let Some(file) = valore.get("path").and_then(Value::as_str).map(str::to_string) {
                valore["path"] = Value::from(nodo_del_file(copia, &file)?.0);
            }
        }
        let con_ids = id == "object.blend.make"
            || id == "object.objectsOnPath.attach"
            || SUI_GRUPPI.contains(&id);
        if con_ids {
            if let Some(ids) = valore.get_mut("ids").and_then(Value::as_array_mut) {
                for id in ids {
                    if let Some(file) = id.as_str() {
                        *id = Value::from(nodo_del_file(copia, file)?.0);
                    }
                }
            }
            return Ok(valore);
        }
        if !SUL_DORSO.contains(&id) {
            return Ok(valore);
        }
        if !valore.is_object() {
            valore = Value::Object(serde_json::Map::new());
        }
        match valore.get("id").and_then(Value::as_str).map(str::to_string) {
            Some(file) => valore["id"] = Value::from(nodo_del_file(copia, &file)?.0),
            None if valore.get("id").is_none_or(Value::is_null) => {
                if let Some(f) = fusione_scelta(copia, selezione) {
                    valore["id"] = Value::from(f.0);
                }
            }
            None => {}
        }
        Ok(valore)
    }
}

/// L'id del file `file` come nodo del motore, o l'argomento che non lo è.
fn nodo_del_file(copia: &Copia, file: &str) -> Result<NodeId, PluginError> {
    nodi_scelti(copia, &[file.to_string()])
        .ok()
        .and_then(|n| n.first().copied())
        .ok_or_else(|| PluginError::BadArgs(format!("«{file}» non è nel disegno.").into()))
}

fn e_fusione(copia: &Copia, n: NodeId) -> bool {
    copia
        .documento
        .node(n)
        .is_some_and(|n| matches!(n.kind, NodeKind::Blend { .. }))
}

/// La prima fusione fra gli oggetti scelti.
fn fusione_scelta(copia: &Copia, selezione: &[String]) -> Option<NodeId> {
    nodi_scelti(copia, selezione)
        .ok()?
        .into_iter()
        .find(|n| e_fusione(copia, *n))
}

/// Il primo gruppo degli Oggetti sul tracciato fra gli oggetti scelti o
/// attorno a uno di loro (`groups_of` del motore).
fn gruppo_sul_tracciato(copia: &Copia, selezione: &[String]) -> Option<NodeId> {
    let d = &copia.documento;
    nodi_scelti(copia, selezione).ok()?.into_iter().find_map(|n| {
        d.ancestry(n)
            .unwrap_or_default()
            .into_iter()
            .rev()
            .find(|a| d.node(*a).is_some_and(is_objects_on_path))
    })
}

/// Vero se fra gli oggetti scelti c'è un tracciato che non è una fusione.
fn con_un_tracciato(copia: &Copia, selezione: &[String]) -> bool {
    nodi_scelti(copia, selezione).is_ok_and(|nodi| {
        nodi.into_iter().any(|n| {
            !e_fusione(copia, n)
                && copia
                    .documento
                    .node(n)
                    .is_some_and(|n| n.path_data().is_some())
        })
    })
}
