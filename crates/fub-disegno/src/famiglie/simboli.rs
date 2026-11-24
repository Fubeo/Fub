//! La famiglia `simboli` della mappa (`docs/reference/scene-format-symbols.md`):
//! il motore tiene i simboli nel documento, e la scrittura nel file sta in
//! [`crate::simboli`] e nella differenza. Lo stato non tiene niente: il
//! simbolo corrente lo tiene la fila degli strumenti e lo passa a ogni
//! comando.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};

use super::{nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// Lo stato della famiglia: non tiene niente.
pub(crate) struct Stato;

/// I comandi che VectorCraft accende solo con una scelta (`has_selection`).
const VOGLIONO_LA_SCELTA: [&str; 4] = [
    "symbol.new",
    "symbol.breakLink",
    "symbol.update",
    "symbol.replace",
];

/// I comandi che leggono la scelta: con un elemento che la mappa non ha si
/// spengono, perché `esegui` li rifiuterebbe. Gli altri prendono il simbolo
/// o i punti dal valore.
const LEGGONO_LA_SCELTA: [&str; 5] = [
    "symbol.new",
    "symbol.breakLink",
    "symbol.update",
    "symbol.replace",
    "symbol.adjust",
];

/// Modifica simbolo ed Esci dalla modalità modifica simbolo: li fa il client, con la sua modalità
/// di modifica dei simboli (`docs/product/drawing-symbols.md`). Il motore non tiene la modalità fra
/// una richiesta e l'altra, e la sua scriverebbe nel file un livello col contenuto del simbolo: qui
/// si rifiutano, e la voce resta accesa per il client.
const DEL_CLIENT: [&str; 2] = ["symbol.edit", "symbol.exitEditing"];

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

    fn rifiuto(id: &str, _copia: &Copia, _selezione: &[String]) -> Option<DrawingRefusal> {
        DEL_CLIENT.contains(&id).then_some(DrawingRefusal::Unsupported)
    }

    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if VOGLIONO_LA_SCELTA.contains(&id) && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if LEGGONO_LA_SCELTA.contains(&id)
            && matches!(nodi_scelti(copia, selezione), Err(DrawingRefusal::Unmapped))
        {
            return Some(DrawingDisabledReason::Unmapped);
        }
        None
    }
}
