//! I file collegati di un documento Craft: una foto piazzata in un disegno è
//! un link del disegno, che il kernel risolve contro la sua cartella.
//!
//! [`collect`] è ancora uno scheletro che non trova niente.

/// I file collegati al massimo per documento.
pub const MAX_LINKS: usize = 1000;
/// I livelli al massimo di JSON che si attraversano.
pub const MAX_DEPTH: usize = 64;

/// I percorsi relativi dei file collegati che il documento nomina, senza
/// doppioni e nell'ordine in cui si trovano.
///
/// Scheletro: non ne trova nessuno.
pub fn collect(doc: &serde_json::Value) -> Vec<String> {
    let _ = doc;
    Vec::new()
}
