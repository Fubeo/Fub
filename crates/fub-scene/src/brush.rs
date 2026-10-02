//! La lettura di `fub:brush` (§5): `pf1` e coppie `chiave=valore`.
//!
//! È la stessa grammatica di `parseBrush` in TypeScript
//! (`apps/client/src/editors/spatial/ink/brush.ts`), che ridisegna i tratti:
//! un pennello che uno dei due lati rifiuta non si ridisegna, quindi devono
//! rifiutare gli stessi.

use std::fmt;

/// Il nome dell'algoritmo: `getStroke` di perfect-freehand 1.2.3.
pub const PF1: &str = "pf1";

/// Le chiavi note, nell'ordine in cui FubDraw le scrive.
pub const PF1_KEYS: [&str; 9] = [
    "size",
    "thinning",
    "smoothing",
    "streamline",
    "taperStart",
    "taperEnd",
    "capStart",
    "capEnd",
    "sim",
];

/// Un pennello `pf1` letto e validato.
#[derive(Clone, Debug, PartialEq)]
pub struct Brush {
    /// Spessore di base in unità, maggiore di 0.
    pub size: f64,
    /// Effetto della pressione sullo spessore, −1…1.
    pub thinning: f64,
    /// Morbidezza del contorno, 0…1.
    pub smoothing: f64,
    /// Quanto il tratto insegue la penna in ritardo, 0…1.
    pub streamline: f64,
    /// Assottigliamento all'inizio e alla fine, in unità; 0 = nessuno.
    pub taper_start: f64,
    pub taper_end: f64,
    /// Estremità arrotondate.
    pub cap_start: bool,
    pub cap_end: bool,
    /// Pressione simulata invece di quella dei campioni.
    pub sim: bool,
    /// Le coppie che `pf1` non conosce, nell'ordine, anche ripetute.
    pub unknown: Vec<(String, String)>,
}

impl Default for Brush {
    /// Le opzioni che `getStroke` usa quando mancano: una chiave nota assente
    /// vale questo.
    fn default() -> Self {
        Brush {
            size: 16.0,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
            taper_start: 0.0,
            taper_end: 0.0,
            cap_start: true,
            cap_end: true,
            sim: true,
            unknown: Vec::new(),
        }
    }
}

/// Perché un `fub:brush` non si legge: ognuno produce S004.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum BrushError {
    /// Un tratto senza `fub:brush`.
    Missing,
    /// Il pennello non comincia con `pf1`.
    Algorithm,
    /// Una voce senza `chiave=valore`, con la chiave o il valore vuoti.
    Entry,
    /// Una chiave nota ripetuta.
    Repeated(&'static str),
    /// Un valore che non è un numero SVG finito.
    Number(&'static str),
    /// Un valore fuori dal suo intervallo.
    Range(&'static str),
}

impl BrushError {
    /// Il nome dell'errore, in kebab-case: è il dettaglio di S004.
    pub fn kind(self) -> &'static str {
        match self {
            BrushError::Missing => "missing",
            BrushError::Algorithm => "algorithm",
            BrushError::Entry => "entry",
            BrushError::Repeated(_) => "repeated",
            BrushError::Number(_) => "number",
            BrushError::Range(_) => "range",
        }
    }

    /// La chiave dell'errore, se l'errore ne ha una.
    pub fn key(self) -> Option<&'static str> {
        match self {
            BrushError::Repeated(key) | BrushError::Number(key) | BrushError::Range(key) => {
                Some(key)
            }
            _ => None,
        }
    }
}

impl fmt::Display for BrushError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BrushError::Missing => f.write_str("il tratto non ha fub:brush"),
            BrushError::Algorithm => f.write_str("fub:brush non comincia con pf1"),
            BrushError::Entry => f.write_str("fub:brush ha una voce senza chiave=valore"),
            BrushError::Repeated(key) => write!(f, "fub:brush ripete {key}"),
            BrushError::Number(key) => write!(f, "{key} di fub:brush non è un numero"),
            BrushError::Range(key) => write!(f, "{key} di fub:brush è fuori dall'intervallo"),
        }
    }
}

impl std::error::Error for BrushError {}

/// Vero se `text` è per intero un numero SVG senza unità: segno facoltativo,
/// cifre con o senza decimali, esponente facoltativo. Come l'espressione
/// regolare di TypeScript ammette `1.`.
fn is_number(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut i = usize::from(matches!(bytes.first(), Some(b'+' | b'-')));
    let digits = |i: &mut usize| {
        let from = *i;
        while bytes.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i - from
    };
    let integer = digits(&mut i);
    let fraction = if bytes.get(i) == Some(&b'.') {
        i += 1;
        digits(&mut i)
    } else {
        0
    };
    if integer == 0 && fraction == 0 {
        return false;
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(bytes.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if digits(&mut i) == 0 {
            return false;
        }
    }
    i == bytes.len()
}

fn number(key: &'static str, text: &str) -> Result<f64, BrushError> {
    if !is_number(text) {
        return Err(BrushError::Number(key));
    }
    // Il valore più vicino, arrotondato come `Number` di JavaScript.
    let value: f64 = text.parse().map_err(|_| BrushError::Number(key))?;
    value
        .is_finite()
        .then_some(value)
        .ok_or(BrushError::Number(key))
}

fn in_range(key: &'static str, value: f64, min: f64, max: f64) -> Result<f64, BrushError> {
    (min..=max)
        .contains(&value)
        .then_some(value)
        .ok_or(BrushError::Range(key))
}

fn flag(key: &'static str, text: &str) -> Result<bool, BrushError> {
    let value = number(key, text)?;
    if value == 0.0 {
        Ok(false)
    } else if value == 1.0 {
        Ok(true)
    } else {
        Err(BrushError::Range(key))
    }
}

impl Brush {
    /// Legge un `fub:brush`. Le voci sono separate da spazi di XML, anche
    /// più d'uno; la prima `=` di una voce separa la chiave dal valore.
    pub fn parse(text: &str) -> Result<Brush, BrushError> {
        let mut tokens = text
            .split([' ', '\t', '\n', '\r'])
            .filter(|t| !t.is_empty());
        if tokens.next() != Some(PF1) {
            return Err(BrushError::Algorithm);
        }
        let mut known: [Option<&str>; 9] = [None; 9];
        let mut unknown = Vec::new();
        for token in tokens {
            let Some((key, value)) = token.split_once('=') else {
                return Err(BrushError::Entry);
            };
            if key.is_empty() || value.is_empty() {
                return Err(BrushError::Entry);
            }
            match PF1_KEYS.iter().position(|&k| k == key) {
                Some(index) => {
                    if known[index].replace(value).is_some() {
                        return Err(BrushError::Repeated(PF1_KEYS[index]));
                    }
                }
                None => unknown.push((key.to_owned(), value.to_owned())),
            }
        }
        let defaults = Brush::default();
        let value = |index: usize, fallback: f64| match known[index] {
            Some(text) => number(PF1_KEYS[index], text),
            None => Ok(fallback),
        };
        let bit = |index: usize, fallback: bool| match known[index] {
            Some(text) => flag(PF1_KEYS[index], text),
            None => Ok(fallback),
        };
        let size = value(0, defaults.size)?;
        if size <= 0.0 {
            return Err(BrushError::Range("size"));
        }
        Ok(Brush {
            size,
            thinning: in_range("thinning", value(1, defaults.thinning)?, -1.0, 1.0)?,
            smoothing: in_range("smoothing", value(2, defaults.smoothing)?, 0.0, 1.0)?,
            streamline: in_range("streamline", value(3, defaults.streamline)?, 0.0, 1.0)?,
            taper_start: in_range("taperStart", value(4, defaults.taper_start)?, 0.0, f64::MAX)?,
            taper_end: in_range("taperEnd", value(5, defaults.taper_end)?, 0.0, f64::MAX)?,
            cap_start: bit(6, defaults.cap_start)?,
            cap_end: bit(7, defaults.cap_end)?,
            sim: bit(8, defaults.sim)?,
            unknown,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_follow_the_typescript_grammar() {
        for valid in [
            "0", "-1", "+2", "1.", ".5", "1.5", "1e3", "1E-3", "-.5e+2", "007",
        ] {
            assert!(is_number(valid), "{valid}");
        }
        for invalid in [
            "", ".", "+", "e3", "1e", "1e+", "0x10", "Infinity", "NaN", "1px", " 1", "1 ", "1..2",
        ] {
            assert!(!is_number(invalid), "{invalid}");
        }
    }
}
