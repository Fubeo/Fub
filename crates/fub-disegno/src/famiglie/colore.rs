//! La famiglia `colore` della mappa (`docs/architecture/disegno-completo.md`,
//! `docs/product/drawing-colors.md`): il suo stato e le regole dei comandi del
//! colore che il motore fa già.
//!
//! - **Il colore attivo** (`paint.*`, Design › Colore): riempimento e tratto,
//!   scambia, di serie, nessuno, inverti, complementare, l'ultimo colore.
//!   Cambiano gli oggetti scelti: senza selezione il motore cambierebbe solo
//!   lo stile delle forme nuove, che la sessione rimette com'era, e il comando
//!   è spento (`no_selection`). `paint.toggleActive` porta davanti il
//!   riempimento o il tratto nella sessione del motore (il tasto X, «Nessuno»
//!   col tasto /): non cambia il file e rende `{fillActive}` come lettura.
//! - **Modifica › Modifica colori** (`edit.colors.*`): sugli oggetti scelti,
//!   anche dentro i gruppi. Satura e Regola bilanciamento colore hanno la
//!   finestra scritta (`catalogo::FINESTRE_SCRITTE`); le fusioni vogliono
//!   almeno tre oggetti con un riempimento pieno: con meno il motore non fa
//!   niente, e il comando è `empty`.
//!
//! **Che cosa non si tocca.** Un oggetto bloccato (lui o un antenato) o un
//! disegno in sola lettura spengono i comandi (`read_only`); un tratto
//! dell'Inchiostro di Fub (`fub:ink`) scelto li spegne (`fub_ink`): il suo
//! colore è nel tratto, che è di Fub. Se il comando lo cambia lo stesso (un
//! gruppo scelto che lo contiene), il risultato non si scrive (`unmapped`).
//!
//! Lo stato: i profili colore caricati, che pesano ma non si svuotano senza
//! rompere i documenti che li nominano.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};
use vectorcraft_doc::color::Paint;
use vectorcraft_doc::{Document, Node, NodeId, NodeKind};

use super::tracciati::{inchiostro_toccato, sceglie_inchiostro};
use super::{byte_delle_tabelle, libera_le_tabelle, nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// Le tabelle del motore che la famiglia fa crescere (patch 0008).
pub(crate) const TABELLE: &[&str] = &["user_profiles"];

/// I comandi del colore attivo che cambiano gli oggetti scelti.
pub(crate) const SUL_COLORE_ATTIVO: [&str; 8] = [
    "paint.setFill",
    "paint.setStroke",
    "paint.swap",
    "paint.default",
    "paint.none",
    "paint.invert",
    "paint.complement",
    "paint.lastColor",
];

/// Il comando che porta davanti il riempimento o il tratto: una lettura.
pub(crate) const ALTERNA: &str = "paint.toggleActive";

/// Le voci di Modifica › Modifica colori.
pub(crate) const MODIFICA_COLORI: [&str; 10] = [
    "edit.colors.invert",
    "edit.colors.toCMYK",
    "edit.colors.toGrayscale",
    "edit.colors.toRGB",
    "edit.colors.saturate",
    "edit.colors.adjustBalance",
    "edit.colors.blendFrontToBack",
    "edit.colors.blendHorizontally",
    "edit.colors.blendVertically",
    "edit.colors.overprintBlack",
];

/// Le fusioni: almeno tre oggetti con un riempimento pieno.
const FUSIONI: [&str; 3] = [
    "edit.colors.blendFrontToBack",
    "edit.colors.blendHorizontally",
    "edit.colors.blendVertically",
];

/// Quanti riempimenti pieni servono a una fusione.
const RIEMPIMENTI_DELLE_FUSIONI: usize = 3;

/// Il comando cambia i colori degli oggetti scelti.
fn sugli_scelti(id: &str) -> bool {
    SUL_COLORE_ATTIVO.contains(&id) || MODIFICA_COLORI.contains(&id)
}

/// Lo stato della famiglia: le sue tabelle nel motore.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        byte_delle_tabelle(TABELLE)
    }

    fn libera(&self) -> u64 {
        libera_le_tabelle(TABELLE)
    }

    fn legge(&self, id: &str) -> bool {
        id == ALTERNA
    }

    /// Senza selezione, su un disegno in sola lettura, su un oggetto bloccato
    /// o su un tratto dell'Inchiostro di Fub, i comandi che cambiano i colori
    /// sono spenti col perché. `paint.toggleActive` non cambia il file: resta
    /// acceso.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if !sugli_scelti(id) {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        match nodi_scelti(copia, selezione) {
            Ok(_) => {}
            Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
        }
        sceglie_inchiostro(copia, selezione).then_some(DrawingDisabledReason::FubInk)
    }

    /// Un tratto dell'Inchiostro scelto è `unmapped`; una fusione con meno di
    /// tre riempimenti pieni non fa niente: `empty`.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if sugli_scelti(id) && sceglie_inchiostro(copia, selezione) {
            return Some(DrawingRefusal::Unmapped);
        }
        if FUSIONI.contains(&id) {
            let scelti = nodi_scelti(copia, selezione).ok()?;
            if riempimenti_pieni(&copia.documento, &scelti) < RIEMPIMENTI_DELLE_FUSIONI {
                return Some(DrawingRefusal::Empty);
            }
        }
        None
    }

    /// Un tratto dell'Inchiostro cambiato, anche se non era scelto (dentro un
    /// gruppo scelto): `unmapped`, e niente si scrive.
    fn rifiuto_dopo(
        id: &str,
        copia: &Copia,
        dopo: &Document,
        _scelti_dopo: &[NodeId],
    ) -> Option<DrawingRefusal> {
        (sugli_scelti(id) && inchiostro_toccato(copia, dopo)).then_some(DrawingRefusal::Unmapped)
    }
}

/// Quante foglie degli oggetti scelti (i gruppi passano ai figli) hanno un
/// riempimento pieno: ciò che le fusioni del motore sfumano (`filled_leaves`
/// di `edit.colors.blend*`, con la stessa lettura del colore).
fn riempimenti_pieni(documento: &Document, scelti: &[NodeId]) -> usize {
    fn pieno(nodo: &Node) -> bool {
        match &nodo.kind {
            NodeKind::Text(testo) => testo.first_style().fill.color().is_some(),
            NodeKind::Mesh(trama) => !trama.points.is_empty(),
            NodeKind::Image(_) => {
                nodo.extras().colorize.as_deref().and_then(Paint::color).is_some()
                    || nodo.appearance.fill_paint().color().is_some()
            }
            _ => nodo.appearance.fill_paint().color().is_some(),
        }
    }
    fn conta(nodo: &Node, quanti: &mut usize) {
        match &nodo.kind {
            NodeKind::Group { children, .. } | NodeKind::Layer { children, .. } => {
                for figlio in children {
                    conta(figlio, quanti);
                }
            }
            _ if pieno(nodo) => *quanti += 1,
            _ => {}
        }
    }
    let mut quanti = 0;
    for nodo in scelti.iter().filter_map(|n| documento.node(*n)) {
        conta(nodo, &mut quanti);
    }
    quanti
}
