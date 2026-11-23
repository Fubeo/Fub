//! Dividi in griglia (`object.path.splitIntoGrid`, K6 T12, la finestra «Dividi in griglia…»).
//!
//! - **Il valore** porta righe, colonne e spaziatura (`gutter`, in punti). Il motore misura la griglia
//!   sul riquadro dei tracciati scelti, e mette le celle al posto loro. Le guide (`addGuides`) non si
//!   chiedono: il formato della scena non le scrive più, e il comando le rifiuta.
//! - **Un testo o una forma primitiva** (un `rect` o un `ellipse` di Fub, che il motore non ha come
//!   nodo) non si divide: `unsupported`, prima dei nodi, con una frase in italiano che dice che fare.
//! - **Una spaziatura più grande dell'oggetto** lascia il motore senza celle: `empty`, e niente cambia.

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use serde_json::Value;
use vectorcraft_engine::EngineError;

use super::solo_testo_o_forme;
use crate::apertura::Copia;

/// Dividi in griglia.
pub(super) const DIVIDI_IN_GRIGLIA: &str = "object.path.splitIntoGrid";

const TESTO_NON_SI_DIVIDE: &str = "Il testo non si divide in griglia: prima crea i profili.";
const FORMA_NON_SI_DIVIDE: &str = "Una forma non si divide in griglia: prima trasformala in tracciato.";
/// Il messaggio del motore quando le celle non entrano (`split_into_grid` in `cmd/pathops.rs`).
const CELLE_NON_ENTRANO: &str = "Split Into Grid: select paths large enough for the grid";

/// Il perché, in italiano, quando la scelta è solo testo o forme primitive.
pub(super) fn frase_spenta(copia: &Copia, selezione: &[String]) -> Option<&'static str> {
    solo_testo_o_forme(copia, selezione).map(|frase| {
        if frase == super::TESTO_NON_SI_SEMPLIFICA {
            TESTO_NON_SI_DIVIDE
        } else {
            FORMA_NON_SI_DIVIDE
        }
    })
}

/// Spento con la frase di testo o di forma, prima dei nodi della scelta.
pub(super) fn spento(copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    frase_spenta(copia, selezione).map(|text| DrawingDisabledReason::Other { text: text.into() })
}

/// Il rifiuto prima dei nodi: testo o forma primitiva, `unsupported`.
pub(super) fn rifiuto_prima(copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
    frase_spenta(copia, selezione).map(|_| DrawingRefusal::Unsupported)
}

/// Il motore senza celle: `empty`. Ogni altro errore resta com'è.
pub(super) fn rifiuto_del_motore(errore: &EngineError) -> Option<DrawingRefusal> {
    matches!(errore, EngineError::Other(m) if m == CELLE_NON_ENTRANO).then_some(DrawingRefusal::Empty)
}

/// Il valore della finestra: righe e colonne intere da 1 a 500, spaziatura da 0 a 1000000 punti.
/// Un campo assente prende il predefinito del motore; le guide no.
pub(super) fn argomenti(valore: Value) -> Result<Value, PluginError> {
    let Some(o) = valore.as_object() else {
        return Err(PluginError::BadArgs("La griglia vuole le sue misure: righe, colonne e spaziatura.".into()));
    };
    let intero = |campo: &str, frase: &str| -> Result<(), PluginError> {
        match o.get(campo).filter(|v| !v.is_null()) {
            None => Ok(()),
            Some(v) => match v.as_f64() {
                Some(n) if n.is_finite() && n.fract() == 0.0 && (1.0..=500.0).contains(&n) => Ok(()),
                _ => Err(PluginError::BadArgs(frase.into())),
            },
        }
    };
    intero("rows", "Le righe vanno da 1 a 500.")?;
    intero("columns", "Le colonne vanno da 1 a 500.")?;
    if let Some(v) = o.get("gutter").filter(|v| !v.is_null()) {
        match v.as_f64() {
            Some(g) if g.is_finite() && (0.0..=1_000_000.0).contains(&g) => {}
            _ => return Err(PluginError::BadArgs("La spaziatura va da 0 a 1000000 punti.".into())),
        }
    }
    if o.get("addGuides").and_then(Value::as_bool) == Some(true) {
        return Err(PluginError::BadArgs("Le guide non si scrivono più nel disegno: la griglia si fa senza.".into()));
    }
    Ok(valore)
}
