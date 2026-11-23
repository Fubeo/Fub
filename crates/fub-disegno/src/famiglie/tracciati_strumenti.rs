//! Gli strumenti dei punti dei tracciati (K6 T12, giro strumenti): la Gomma dei punti
//! (`addon.pathtools.erase`) e i controlli di «Imposta punto di ancoraggio» (`addon.pathtools.setAnchor`).
//!
//! - **La Gomma** è un tratto di pennello: il valore porta i punti del tratto in coordinate di scena (come
//!   la Gomma a mano della famiglia `mano`), il diametro (0,1 – 2500 punti) e la tolleranza (1 – 100). Il
//!   motore toglie i punti che il pennello tocca e che si possono togliere; sugli oggetti scelti, come le
//!   altre voci senza finestra. Il tratto arriva in un comando solo, alla fine del gesto: niente chiamate al
//!   motore a ogni movimento. Un testo scelto è `unsupported` prima del motore; un oggetto nascosto non si
//!   tocca (`empty`); il pennello che non tocca niente, o un punto che non si può togliere, è `empty`.
//! - **Imposta punto** lavora sui punti scelti (`anchors`, come «Sposta punti»). Senza punti il motore
//!   muoverebbe tutti i punti dell'oggetto intero: il comando lo rifiuta in italiano prima di farlo.

use fub_abi::{DrawingRefusal, PluginError};
use serde_json::Value;
use vectorcraft_doc::NodeKind;

use super::mano::nel_documento;
use crate::apertura::Copia;

/// La Gomma dei punti.
pub(crate) const GOMMA_PUNTI: &str = "addon.pathtools.erase";
pub(crate) const IMPOSTA_PUNTO: &str = "addon.pathtools.setAnchor";

/// Gli strumenti di questo modulo che il valore controlla prima del motore.
pub(crate) const STRUMENTI: [&str; 2] = [GOMMA_PUNTI, IMPOSTA_PUNTO];

/// Gli argomenti degli strumenti dei punti, prima del motore e col perché in italiano.
pub(super) fn argomenti(id: &str, copia: &Copia, mut valore: Value) -> Result<Value, PluginError> {
    if id == IMPOSTA_PUNTO {
        let con_punti = valore.get("anchors").and_then(Value::as_array).is_some_and(|p| !p.is_empty());
        if !con_punti {
            return Err(PluginError::BadArgs(
                "Scegli i punti da muovere: senza punti il motore muoverebbe tutti i punti dell'oggetto.".into(),
            ));
        }
        return Ok(valore);
    }
    if id != GOMMA_PUNTI {
        return Ok(valore);
    }
    let Some(o) = valore.as_object_mut() else {
        return Err(PluginError::BadArgs("La gomma vuole il suo tratto: i punti, e il diametro.".into()));
    };
    if o.contains_key("ids") {
        return Err(PluginError::BadArgs(
            "La gomma lavora sugli oggetti scelti: non si passano gli id del motore.".into(),
        ));
    }
    let diametro = o.get("diameter").filter(|v| !v.is_null()).map(|v| v.as_f64());
    match diametro {
        None => {}
        Some(Some(d)) if d.is_finite() && (0.1..=2500.0).contains(&d) => {}
        Some(_) => return Err(PluginError::BadArgs("Il diametro della gomma va da 0,1 a 2500 punti.".into())),
    }
    let tolleranza = o.get("tolerance").filter(|v| !v.is_null()).map(|v| v.as_f64());
    match tolleranza {
        None => {}
        Some(Some(t)) if t.is_finite() && (1.0..=100.0).contains(&t) => {}
        Some(_) => return Err(PluginError::BadArgs("La tolleranza della gomma va da 1 a 100.".into())),
    }
    for campo in ["ignoreTolerance", "plain"] {
        if o.get(campo).is_some_and(|v| !v.is_null() && !v.is_boolean()) {
            return Err(PluginError::BadArgs(format!("«{campo}» è vero o falso.").into()));
        }
    }
    let Some(Value::Array(punti)) = o.get_mut("points") else {
        return Err(PluginError::BadArgs("La gomma vuole il suo tratto: una lista di punti [x, y].".into()));
    };
    let dritti = punti.iter().all(|p| {
        p.as_array().is_some_and(|a| (a.len() == 2 || a.len() == 3) && a.iter().all(|n| n.as_f64().is_some_and(f64::is_finite)))
    });
    if punti.is_empty() || !dritti {
        return Err(PluginError::BadArgs("La gomma vuole il suo tratto: una lista di punti [x, y].".into()));
    }
    nel_documento(punti, copia);
    Ok(valore)
}

/// Il rifiuto della Gomma prima del motore: un testo scelto (`unsupported`, come i tagli), un oggetto
/// scelto nascosto (`empty`). L'inchiostro e i bloccati li dicono le regole dei comandi sugli oggetti.
pub(super) fn rifiuto(copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
    let con_testo = selezione.iter().any(|id| {
        let mut testo = false;
        if let Some(nodo) = copia.mappa.dell_id(id).and_then(|i| copia.mappa.elemento(i)).and_then(|e| e.nodo).and_then(|n| copia.documento.node(n)) {
            nodo.walk(&mut |c| testo |= matches!(c.kind, NodeKind::Text(_)));
        }
        testo
    });
    if con_testo {
        return Some(DrawingRefusal::Unsupported);
    }
    crate::famiglie::trasforma::scelto_nascosto(copia, selezione).then_some(DrawingRefusal::Empty)
}
