//! La famiglia `livelli` della mappa: le voci di ≡ › Selezione che il menu fa
//! oggi (K6 T15, giro 1). Selezionare non cambia il documento: queste voci non
//! scrivono niente, e il motore dice che cosa seleziona; qui si dice soltanto
//! quando una voce non vale per ciò che è scelto, col suo perché.

use std::sync::Arc;

use fub_abi::DrawingDisabledReason;
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;

use super::StatoFamiglia;
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

    /// Le voci di ≡ › Selezione spente col loro perché, prima di chiedere al motore.
    /// Il confronto con l'oggetto scelto (Uguale) e «Tutto sugli stessi livelli»
    /// vogliono qualcosa di scelto; l'istanza di simbolo vuole un'istanza scelta;
    /// «Tutti gli oggetti di testo» vuole un testo nel disegno. Le altre valgono
    /// sempre: il motore dice ciò che seleziona, anche niente.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if vuole_selezione(id) && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        match id {
            "select.same.symbolInstance" => {
                let istanza = |nome: &String| {
                    copia
                        .mappa
                        .dell_id(nome)
                        .and_then(|i| copia.mappa.elemento(i))
                        .is_some_and(|e| e.ruolo == Role::Instance)
                };
                (!selezione.iter().any(istanza)).then(|| DrawingDisabledReason::Other {
                    text: "Non è un'istanza.".into(),
                })
            }
            "select.object.textObjects" => {
                let c_e_testo = copia.mappa.elementi().iter().any(|e| e.ruolo == Role::Text);
                (!c_e_testo).then(|| DrawingDisabledReason::Other {
                    text: "Nel disegno non ci sono oggetti di testo.".into(),
                })
            }
            _ => None,
        }
    }
}

/// I comandi di ≡ › Selezione che lavorano su ciò che è scelto: il confronto con
/// l'oggetto scelto, e «Tutto sugli stessi livelli». Gli altri lavorano su tutto
/// il disegno.
fn vuole_selezione(id: &str) -> bool {
    id.starts_with("select.same.") || id == "select.object.allOnSameLayers"
}
