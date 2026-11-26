//! I tagli dei tracciati (K6 T12, giro tagli): «Taglio con linea» (`path.lineCut`), «Taglio con
//! rettangolo» (`path.rectCut`) e «Specchia e taglia» (`path.mirrorCut`). Il motore taglia i tracciati
//! scelti e i tracciati composti, e scrive le sue operazioni: un taglio con linea o che attraversa una
//! forma aggiunge un pezzo nuovo (un tracciato con id del motore), uno con rettangolo ritaglia in place
//! e toglie ciò che è fuori, uno speculare unisce le due metà in un solo contorno.
//!
//! Prima del motore, con le parole in italiano: i punti dei tagli (due numeri a punto, e i due punti di
//! una linea o di un rettangolo distinti), l'asse dello specchio. E si fermano prima del motore il testo
//! (il motore direbbe «select paths or compound paths», in inglese, come Distorci: `unsupported`) e
//! un oggetto scelto nascosto (il motore lo taglierebbe lo stesso, e Fub non lo tocca: `empty`).
//! Un taglio che non tocca niente lo dice il motore: `empty`, come «Rendi angolo».

use fub_abi::{DrawingRefusal, PluginError};
use serde_json::Value;
use vectorcraft_doc::NodeKind;

use crate::famiglie::trasforma::scelto_nascosto;
use crate::apertura::Copia;

/// I tre tagli dei tracciati.
pub(crate) const TAGLI: [&str; 3] = ["path.lineCut", "path.rectCut", "path.mirrorCut"];

/// Un punto `[x, y]` di due numeri finiti.
fn punto(v: &Value) -> Option<[f64; 2]> {
    let lista = v.as_array()?;
    match lista.as_slice() {
        [x, y] => {
            let (x, y) = (x.as_f64()?, y.as_f64()?);
            (x.is_finite() && y.is_finite()).then_some([x, y])
        }
        _ => None,
    }
}

/// Il punto `chiave` del valore, se c'è: `Ok(None)` se manca, errore se non è un punto.
fn punto_del_valore(valore: &Value, chiave: &str) -> Result<Option<[f64; 2]>, PluginError> {
    match valore.get(chiave).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => punto(v)
            .map(Some)
            .ok_or_else(|| PluginError::BadArgs(format!("«{chiave}» è un punto: due numeri, [x, y].").into())),
    }
}

/// Gli argomenti dei tagli, prima del motore e col perché in italiano.
pub(super) fn argomenti(id: &str, valore: &Value) -> Result<Value, PluginError> {
    match id {
        "path.lineCut" => {
            let da = punto_del_valore(valore, "from")?;
            let a = punto_del_valore(valore, "to")?;
            match (da, a) {
                (Some(da), Some(a)) if da == a => {
                    Err(PluginError::BadArgs("I due punti della linea sono lo stesso punto: serve una linea.".into()))
                }
                (Some(_), Some(_)) => Ok(valore.clone()),
                _ => Err(PluginError::BadArgs("Scegli i due punti della linea di taglio.".into())),
            }
        }
        "path.rectCut" => {
            if let Some(rettangolo) = valore.get("rect").filter(|v| !v.is_null()) {
                let ok = rettangolo.as_array().is_some_and(|lista| {
                    lista.len() == 4 && lista.iter().all(|n| n.as_f64().is_some_and(f64::is_finite))
                });
                if !ok {
                    return Err(PluginError::BadArgs("Il rettangolo di taglio è [x, y, larghezza, altezza].".into()));
                }
                let larghezza = rettangolo[2].as_f64().unwrap_or(0.0);
                let altezza = rettangolo[3].as_f64().unwrap_or(0.0);
                if larghezza <= 0.0 || altezza <= 0.0 {
                    return Err(PluginError::BadArgs("Il rettangolo di taglio ha larghezza e altezza positive.".into()));
                }
                return Ok(valore.clone());
            }
            let da = punto_del_valore(valore, "from")?;
            let a = punto_del_valore(valore, "to")?;
            match (da, a) {
                (Some(da), Some(a)) if da != a => Ok(valore.clone()),
                (Some(_), Some(_)) => Err(PluginError::BadArgs("I due angoli del rettangolo sono lo stesso punto.".into())),
                _ => Err(PluginError::BadArgs("Scegli i due angoli opposti del rettangolo di taglio.".into())),
            }
        }
        "path.mirrorCut" => {
            if let Some(asse) = valore.get("axis").filter(|v| !v.is_null()) {
                let ammesso = asse.as_str().is_some_and(|a| ["vertical", "horizontal", "free"].contains(&a));
                if !ammesso {
                    return Err(PluginError::BadArgs("L'asse è «vertical», «horizontal» o «free».".into()));
                }
            }
            let da = punto_del_valore(valore, "from")?;
            let a = punto_del_valore(valore, "to")?;
            if valore.get("axis").and_then(Value::as_str) == Some("free") {
                match (da, a) {
                    (Some(da), Some(a)) if da != a => {}
                    _ => {
                        return Err(PluginError::BadArgs(
                            "L'asse libero passa per due punti diversi: «from» e «to».".into(),
                        ));
                    }
                }
            }
            Ok(valore.clone())
        }
        _ => Ok(valore.clone()),
    }
}

/// Vero se uno degli oggetti scelti ha un testo (un `text`, o un testo dentro un gruppo).
fn contiene_testo(copia: &Copia, selezione: &[String]) -> bool {
    selezione.iter().any(|id| {
        let mut testo = false;
        if let Some(nodo) = copia.mappa.dell_id(id).and_then(|i| copia.mappa.elemento(i)).and_then(|e| e.nodo).and_then(|n| copia.documento.node(n)) {
            nodo.walk(&mut |c| testo |= matches!(c.kind, NodeKind::Text(_)));
        }
        testo
    })
}

/// Il rifiuto dei tagli prima del motore: un testo scelto (`unsupported`) o un oggetto scelto nascosto
/// (`empty`). Il resto (inchiostro, bloccati, nessun tracciato) lo dicono le regole della famiglia.
pub(super) fn rifiuto(copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
    // Il testo dei tagli: il motore lo rifiuta con la sua frase in inglese, qui non si arriva.
    if contiene_testo(copia, selezione) {
        return Some(DrawingRefusal::Unsupported);
    }
    scelto_nascosto(copia, selezione).then_some(DrawingRefusal::Empty)
}
