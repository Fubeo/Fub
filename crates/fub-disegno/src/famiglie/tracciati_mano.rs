//! I gesti a mano libera dei tracciati come comandi del disegno (piano K6, T12,
//! giro 9): Matita (`path.freehand`), Gomma (`path.eraseRegion`), Cancella
//! tracciato (`path.eraseSegments`), Coltello (`path.knife`) e Smussa
//! (`path.smoothRegion`). Gli strumenti di «disegnare» con lo stesso nome
//! (`gesti/strumento.rs`) li fanno dal gesto; questi sono gli stessi comandi
//! del motore, con il loro valore, per chi li chiama con un comando.
//!
//! - **La Matita** non vuole una selezione: il suo tracciato è nuovo. Il
//!   valore porta i punti in coordinate di scena, e i campi che nominano un
//!   tracciato del motore (`extend`, `connect`, `redraw`) non si passano: il
//!   comando li rifiuta con `bad_args`, perché un id del motore non è un id di
//!   Fub e potrebbe toccare un oggetto che la selezione non dice.
//! - **Il Coltello e la Gomma** lavorano sui tracciati scelti, o su tutti se la
//!   selezione è vuota (come dice il motore). Un oggetto scelto che non è un
//!   tracciato (un'immagine, un testo) non ha niente da tagliare: `unmapped`.
//! - **Cancella tracciato e Smussa** lavorano solo sui tracciati scelti: senza
//!   selezione sono spenti con `no_selection` e il comando è `empty`.
//! - In ogni caso un tratto della penna di Fub scelto è `fub_ink` (spento) o
//!   `unmapped` (comando); un tratto toccato senza essere scelto lo prende il
//!   controllo dopo il comando (`inchiostro_toccato`, in `tracciati.rs`).
//! - I numeri del valore (`size`, `width`, `radius`, `tolerance`) sono nelle
//!   unità del motore, come per gli strumenti: il motore li controlla.

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_scene::Role;
use serde_json::Value;
use vectorcraft_doc::{Node, NodeId, NodeKind};

use super::super::nodi_scelti;
use super::sceglie_inchiostro;
use crate::apertura::Copia;

/// La Matita: un tracciato nuovo, senza selezione.
pub(super) const MATITA: &str = "path.freehand";

/// I comandi a mano libera, nell'ordine della mappa.
pub(super) const MANO: [&str; 5] = [
    MATITA,
    "path.eraseRegion",
    "path.eraseSegments",
    "path.knife",
    "path.smoothRegion",
];

/// Il comando lavora sui tracciati scelti, o su tutti se non c'è selezione
/// (Gomma e Coltello).
fn su_tutti_senza_scelta(id: &str) -> bool {
    matches!(id, "path.eraseRegion" | "path.knife")
}

/// Il campo del valore che nomina un tracciato del motore: non si passa.
const CAMPI_DEL_MOTORE: [&str; 3] = ["extend", "connect", "redraw"];

/// Un oggetto che i comandi a mano libera possono cambiare: un tracciato, un
/// tracciato composto, o un gruppo che ne ha almeno uno (il motore lo
/// espande). Un testo e un'immagine no.
fn tracciato(nodo: &Node) -> bool {
    match &nodo.kind {
        NodeKind::Path { guide, .. } => !guide,
        NodeKind::Compound { .. } => true,
        NodeKind::Group { children, .. } => children.iter().any(|c| tracciato(c)),
        _ => false,
    }
}

/// Spento: la Matita vale sempre (con il disegno modificabile); gli altri
/// vogliono una selezione di tracciati, o nessuna per Gomma e Coltello.
pub(super) fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    if !copia.modificabile {
        return Some(DrawingDisabledReason::ReadOnly);
    }
    if id == MATITA {
        return None;
    }
    if selezione.is_empty() {
        return (!su_tutti_senza_scelta(id)).then_some(DrawingDisabledReason::NoSelection);
    }
    let nodi = match nodi_scelti(copia, selezione) {
        Ok(nodi) => nodi,
        Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
        Err(_) => return Some(DrawingDisabledReason::Unmapped),
    };
    if sceglie_inchiostro(copia, selezione) {
        return Some(DrawingDisabledReason::FubInk);
    }
    let ha_tracciati = nodi
        .iter()
        .any(|n| copia.documento.node(*n).is_some_and(tracciato));
    (!ha_tracciati).then_some(DrawingDisabledReason::NeedsPath)
}

/// Il rifiuto del comando prima che giri: Cancella tracciato e Smussa senza
/// selezione sono `empty`; un tratto della penna di Fub scelto è `unmapped`; una
/// selezione senza tracciati (un'immagine, un testo) è `unmapped`.
pub(super) fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
    if id == MATITA {
        return None;
    }
    if selezione.is_empty() {
        return (!su_tutti_senza_scelta(id)).then_some(DrawingRefusal::Empty);
    }
    let nodi = nodi_scelti(copia, selezione).ok()?;
    if sceglie_inchiostro(copia, selezione) {
        return Some(DrawingRefusal::Unmapped);
    }
    let ha_tracciati = nodi
        .iter()
        .any(|n| copia.documento.node(*n).is_some_and(tracciato));
    (!ha_tracciati).then_some(DrawingRefusal::Unmapped)
}

/// La Matita non porta il livello: il tracciato va nel livello più alto, visibile
/// e non bloccato, come le forme (`forme.rs`). Senza livello, o tutti bloccati,
/// è `locked`. Gli altri comandi a mano libera lavorano dove sono.
pub(super) fn livello(id: &str, copia: &Copia) -> Result<Option<NodeId>, DrawingRefusal> {
    if id != MATITA {
        return Ok(None);
    }
    let mut livelli: Vec<_> = copia.mappa.elementi().iter().filter(|e| e.ruolo == Role::Layer).collect();
    if livelli.is_empty() {
        return Ok(None);
    }
    livelli.sort_by(|a, b| a.percorso.cmp(&b.percorso));
    let scelto = livelli
        .iter()
        .rev()
        .find(|e| !e.nascosto && !e.bloccato)
        .ok_or(DrawingRefusal::Locked)?;
    scelto.nodo.map(Some).ok_or(DrawingRefusal::Unmapped)
}

/// Il valore del comando nel documento del motore: i punti passano da coordinate
/// di scena a quelle del documento (come i punti dei comandi su un punto), i campi
/// che nominano un tracciato del motore sono rifiutati.
pub(super) fn argomenti(id: &str, copia: &Copia, mut valore: Value) -> Result<Value, PluginError> {
    let Some(o) = valore.as_object_mut() else {
        return Ok(valore);
    };
    if let Some(campo) = CAMPI_DEL_MOTORE.iter().find(|c| o.contains_key(**c)) {
        return Err(PluginError::BadArgs(
            format!("{id}: `{campo}` nomina un tracciato del motore, e il comando non li accetta")
                .into(),
        ));
    }
    if let Some(Value::Array(punti)) = o.get_mut("points") {
        nel_documento(punti, copia);
    }
    Ok(valore)
}

/// Porta i punti `[x, y]` o `[x, y, pressione]` dalla scena al documento; ciò che
/// non è un punto numerico lo lascia com'è, e il motore lo rifiuta.
pub(super) fn nel_documento(punti: &mut [Value], copia: &Copia) {
    let radice = copia.radice;
    for p in punti.iter_mut() {
        let Some(a) = p.as_array_mut() else { continue };
        let (Some(x), Some(y)) = (a.first().and_then(Value::as_f64), a.get(1).and_then(Value::as_f64))
        else {
            continue;
        };
        let q = radice * vectorcraft_geom::Point::new(x, y);
        a[0] = numero(q.x);
        a[1] = numero(q.y);
    }
}

fn numero(x: f64) -> Value {
    serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
}
