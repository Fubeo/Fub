//! La famiglia `forme` della mappa: il suo stato e i suoi comandi
//! (`docs/architecture/disegno-completo.md`). Le forme di T13 giro 1: gli
//! strumenti di forma passano dal ponte del motore (`gesti/strumento.rs`), e i
//! comandi `shape.*` delle finestre delle misure vengono da qui.

use std::sync::Arc;

use fub_abi::DrawingRefusal;
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;
use vectorcraft_doc::NodeId;

use super::StatoFamiglia;
use crate::apertura::Copia;
use crate::catalogo::COMANDI_DI_FORMA;

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

    /// Una forma nuova va nello stesso livello dove andrebbe lo strumento senza
    /// un livello scelto: il più alto che non è nascosto né bloccato. Senza
    /// livelli, la radice (`None`). Un livello bloccato o nascosto per tutti
    /// dice perché, come il gesto.
    fn livello(id: &str, copia: &Copia) -> Result<Option<NodeId>, DrawingRefusal> {
        if !COMANDI_DI_FORMA.contains(&id) {
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
}
