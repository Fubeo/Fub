//! La curva della pressione: come la forza della mano diventa la pressione
//! dei campioni, e così lo spessore del tratto.
//!
//! Ogni penna e ogni mano premono a modo loro: c'è chi preme leggero e vuole
//! lo stesso il tratto pieno, e chi preme forte e vuole le sfumature. La curva
//! ha tre manopole, come i pannelli delle tavolette:
//!
//! - **la morbidezza** (`soft`, da −1 a 1): sopra lo zero una pressione
//!   leggera dà già molto, sotto ne serve di più. È l'esponente della curva,
//!   da 3 (dura) a ⅓ (morbida);
//! - **il minimo** (`min`, da 0 a 0,5): la pressione che anche il tocco più
//!   leggero dà, perché un tratto leggero non sparisca;
//! - **il pieno** (`full`, da 0,5 a 1): da dove la penna dà già tutto, per
//!   chi non vuole premere fino in fondo.
//!
//! La curva vale solo per la penna, l'unica che misura la pressione; il file
//! tiene la pressione già curvata, quella che si vede. È della macchina e non
//! del documento: ogni tavoletta ha la sua.

/// Il minimo più alto: oltre, la penna non avrebbe più sfumature.
pub const MAX_MIN: f64 = 0.5;

/// Il pieno più basso: sotto, mezza corsa darebbe già tutto.
pub const MIN_FULL: f64 = 0.5;

/// La curva della pressione della penna.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct PenCurve {
    /// La morbidezza, da −1 (dura) a 1 (morbida).
    pub soft: f64,
    /// La pressione più leggera, da 0 a [`MAX_MIN`].
    pub min: f64,
    /// La pressione da cui il tratto è pieno, da [`MIN_FULL`] a 1.
    pub full: f64,
}

/// La curva di serie, la diagonale: la pressione come la penna la dà.
pub const DEFAULT_CURVE: PenCurve = PenCurve {
    soft: 0.0,
    min: 0.0,
    full: 1.0,
};

impl Default for PenCurve {
    fn default() -> PenCurve {
        DEFAULT_CURVE
    }
}

impl PenCurve {
    /// La curva con questi valori, se stanno nei loro intervalli: tre numeri
    /// finiti, `soft` in −1…1, `min` in 0…[`MAX_MIN`], `full` in
    /// [`MIN_FULL`]…1.
    pub fn new(soft: f64, min: f64, full: f64) -> Option<PenCurve> {
        let within = |n: f64, lo: f64, hi: f64| n.is_finite() && n >= lo && n <= hi;
        if within(soft, -1.0, 1.0) && within(min, 0.0, MAX_MIN) && within(full, MIN_FULL, 1.0) {
            Some(PenCurve { soft, min, full })
        } else {
            None
        }
    }

    /// Vero se la curva lascia la pressione com'è.
    pub fn is_default(&self) -> bool {
        *self == DEFAULT_CURVE
    }

    /// La pressione del tratto per una pressione `pressure` da 0 a 1 della
    /// penna, anch'essa da 0 a 1. Cresce sempre: premere di più non dà mai
    /// meno.
    pub fn apply(&self, pressure: f64) -> f64 {
        let power = 3f64.powf(-self.soft);
        let p = (pressure / self.full).clamp(0.0, 1.0);
        self.min + (1.0 - self.min) * p.powf(power)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_curva_di_serie_e_la_diagonale() {
        for i in 0..=20 {
            let p = f64::from(i) / 20.0;
            assert!((DEFAULT_CURVE.apply(p) - p).abs() < 1e-12, "{p}");
        }
        assert!(DEFAULT_CURVE.is_default());
    }

    #[test]
    fn il_minimo_e_il_pieno_fissano_gli_estremi() {
        let curve = PenCurve::new(0.0, 0.2, 0.8).unwrap();
        assert!((curve.apply(0.0) - 0.2).abs() < 1e-12);
        assert!((curve.apply(0.8) - 1.0).abs() < 1e-12);
        assert!((curve.apply(1.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn la_morbidezza_sopra_zero_da_di_piu_a_una_pressione_leggera() {
        let soft = PenCurve::new(1.0, 0.0, 1.0).unwrap();
        let hard = PenCurve::new(-1.0, 0.0, 1.0).unwrap();
        assert!(soft.apply(0.25) > 0.25);
        assert!(hard.apply(0.25) < 0.25);
    }

    #[test]
    fn la_curva_non_decresce_mai() {
        for (soft, min, full) in [(-1.0, 0.0, 1.0), (1.0, 0.5, 0.5), (0.3, 0.1, 0.9)] {
            let curve = PenCurve::new(soft, min, full).unwrap();
            let mut last = -1.0;
            for i in 0..=200 {
                let value = curve.apply(f64::from(i) / 200.0);
                assert!(value >= last, "{curve:?} a {i}");
                assert!((0.0..=1.0).contains(&value));
                last = value;
            }
        }
    }

    #[test]
    fn una_curva_fuori_dagli_intervalli_non_esiste() {
        assert!(PenCurve::new(1.1, 0.0, 1.0).is_none());
        assert!(PenCurve::new(0.0, 0.6, 1.0).is_none());
        assert!(PenCurve::new(0.0, 0.0, 0.4).is_none());
        assert!(PenCurve::new(f64::NAN, 0.0, 1.0).is_none());
        assert!(PenCurve::new(0.0, f64::INFINITY, 1.0).is_none());
    }
}
