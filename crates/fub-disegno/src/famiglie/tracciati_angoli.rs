//! Gli angoli vivi di Rendi angoli (K6 T12, giro angoli): «Imposta angoli» e «Rimuovi angoli»,
//! `addon.pathtools.cornerSet` e `addon.pathtools.cornerRemove`. Il motore taglia e toglie gli
//! angoli dal modello di angoli vivi del tracciato (`LiveCorners`), e il file tiene quel modello
//! nella ricetta (`vectorcraft:recipe`), così che «Rimuovi» torna alla forma viva anche riaperto.
//!
//! Quello che la famiglia controlla prima del motore, con le parole in italiano: il raggio (un numero
//! da 0 a 1000000 punti, obbligatorio), lo smusso (`kind`, uno dei tre), i punti (numeri interi). E un
//! comando che non ha nessun angolo da cambiare (un punto liscio, un punto in fondo a un tracciato
//! aperto, un testo) è `empty`, come «Rendi angolo», e non va al motore, che direbbe la sua frase in
//! inglese («choose anchors where two sides meet at an angle»).
//!
//! Un indice di punto che il tracciato non ha è `empty` anch'esso: la richiesta non dice quale oggetto
//! scegliere (il valore non porta la scelta), e `rifiuto_valore` non può dare un testo.

use fub_abi::{DrawingRefusal, PluginError};
use serde_json::Value;
use vectorcraft_doc::{LiveCorners, Node};

use super::nodi_scelti;
use crate::apertura::Copia;

/// Il raggio più grande che il motore accetta (`MAX_RADIUS` del Rendi angoli).
const RAGGIO_MASSIMO: f64 = 1_000_000.0;

/// Gli smussi che il comando accetta (`kind`).
const SMUSSI: [&str; 3] = ["round", "invertedRound", "chamfer"];

/// I due comandi di angoli vivi.
pub(crate) const ANGOLI: [&str; 2] = ["addon.pathtools.cornerSet", "addon.pathtools.cornerRemove"];

const IMPOSTA: &str = "addon.pathtools.cornerSet";

/// Gli argomenti degli angoli, prima del motore e col perché in italiano.
pub(super) fn argomenti(id: &str, valore: Value) -> Result<Value, PluginError> {
    if id == IMPOSTA {
        match valore.get("radius").filter(|v| !v.is_null()) {
            None => return Err(PluginError::BadArgs("Scegli il raggio dell'angolo, da 0 a 1000000 punti.".into())),
            Some(v) => match v.as_f64() {
                Some(r) if r.is_finite() && (0.0..=RAGGIO_MASSIMO).contains(&r) => {}
                Some(_) => return Err(PluginError::BadArgs("Il raggio va da 0 a 1000000 punti.".into())),
                None => return Err(PluginError::BadArgs("Il raggio è un numero di punti, non un testo.".into())),
            },
        }
        if let Some(kind) = valore.get("kind").filter(|v| !v.is_null()) {
            if !kind.as_str().is_some_and(|k| SMUSSI.contains(&k)) {
                return Err(PluginError::BadArgs("L'angolo è «round», «invertedRound» o «chamfer».".into()));
            }
        }
    }
    if let Some(punti) = valore.get("anchors").filter(|v| !v.is_null()) {
        let interi = punti.as_array().is_some_and(|lista| lista.iter().all(|k| k.as_u64().is_some()));
        if !interi {
            return Err(PluginError::BadArgs("I punti sono numeri interi, dal primo: 0, 1, 2…".into()));
        }
    }
    Ok(valore)
}

/// Vero se gli angoli chiesti non cambiano niente: nessun oggetto scelto ha un angolo, al punto o
/// ai punti che il valore dice (o, senza punti, a nessuno dei suoi), o un punto chiesto non c'è.
pub(super) fn senza_angoli(copia: &Copia, selezione: &[String], valore: &Value) -> bool {
    let Ok(nodi) = nodi_scelti(copia, selezione) else {
        return false;
    };
    let punti: Option<Vec<usize>> = valore
        .get("anchors")
        .filter(|v| !v.is_null())
        .and_then(Value::as_array)
        .map(|lista| lista.iter().filter_map(|k| k.as_u64().and_then(|k| usize::try_from(k).ok())).collect());
    let mut c_e_un_angolo = false;
    for id in nodi {
        let Some(nodo) = copia.documento.node(id) else { continue };
        let Some(angoli) = angoli_di(nodo) else { continue };
        let n = angoli.base.anchor_count();
        match &punti {
            // Un punto che il tracciato non ha: il comando non va, la richiesta è vuota.
            Some(lista) if lista.iter().any(|k| *k >= n) => return true,
            Some(lista) => c_e_un_angolo |= lista.iter().any(|k| angoli.corner(*k).is_some()),
            None => c_e_un_angolo |= !angoli.all().is_empty(),
        }
    }
    !c_e_un_angolo
}

/// Il modello di angoli vivi di un nodo, se è un tracciato (un testo non ne ha).
fn angoli_di(nodo: &Node) -> Option<LiveCorners<'_>> {
    LiveCorners::of(nodo)
}

/// Il rifiuto degli angoli: `empty` quando non c'è niente da cambiare (vedi `senza_angoli`).
pub(super) fn rifiuto(copia: &Copia, selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
    senza_angoli(copia, selezione, valore).then_some(DrawingRefusal::Empty)
}
