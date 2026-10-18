//! Il campione di un tratto: un punto dell'inchiostro prima della
//! quantizzazione.
//!
//! È ciò che il ciclo di vita consegna a chi disegna l'anteprima e a chi
//! scrive il tratto, e ciò che il codec di `fub:ink` (§5) quantizza in interi.
//! Sta in questo crate, che non conosce il formato dei file, perché lo
//! producono tutti i prodotti che raccolgono inchiostro e lo leggono tutti
//! quelli che lo scrivono.

/// Quanti campioni può avere un tratto (formato della scena, §5 e §11). Oltre,
/// il ciclo di vita chiude il tratto e ne comincia un altro dallo stesso punto.
pub const MAX_SAMPLES: usize = 10_000;

/// Un campione come arriva dal dispositivo, in unità locali dell'elemento.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Sample {
    pub x: f64,
    pub y: f64,
    /// Pressione 0…1; `None` per mouse e tocco.
    pub p: Option<f64>,
    /// Millisecondi dal primo campione, che vale 0.
    pub t: f64,
    /// Altitudine e azimut in gradi, se il dispositivo li dà.
    pub tilt: Option<(f64, f64)>,
}
