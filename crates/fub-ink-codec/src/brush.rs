//! La lettura di `fub:brush` (§5): `pf1` o `nib1` e coppie `chiave=valore`.
//!
//! È la stessa grammatica di `parseInkBrush` in TypeScript
//! (`apps/client/src/ink/brush.ts`), che ridisegna i tratti:
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

/// Il nome della punta piatta della Calligrafia.
pub const NIB1: &str = "nib1";

/// Le chiavi note di `nib1`, nell'ordine in cui FubDraw le scrive.
pub const NIB1_KEYS: [&str; 9] = [
    "size",
    "tip",
    "angle",
    "fixation",
    "thinning",
    "tilt",
    "smoothing",
    "streamline",
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

/// Un pennello `nib1`, la punta piatta, letto e validato.
#[derive(Clone, Debug, PartialEq)]
pub struct Nib1Brush {
    /// Larghezza della punta in unità, maggiore di 0.
    pub size: f64,
    /// Spessore della punta in unità, 0 o più: il tratto non è mai più sottile.
    pub tip: f64,
    /// Angolo della punta in gradi, −180…180.
    pub angle: f64,
    /// Quanto la punta tiene l'angolo invece di seguire la direzione, 0…1.
    pub fixation: f64,
    /// Effetto della pressione sulla larghezza, 0…1.
    pub thinning: f64,
    /// L'angolo dall'azimut del campione, quando il tratto lo porta.
    pub tilt: bool,
    /// Levigatura della direzione, 0…1.
    pub smoothing: f64,
    /// Quanto il tratto insegue la penna in ritardo, 0…1.
    pub streamline: f64,
    /// Pressione ignorata.
    pub sim: bool,
    /// Le coppie che `nib1` non conosce, nell'ordine, anche ripetute.
    pub unknown: Vec<(String, String)>,
}

impl Default for Nib1Brush {
    /// I valori di una chiave di `nib1` che manca.
    fn default() -> Self {
        Nib1Brush {
            size: 12.0,
            tip: 1.0,
            angle: 35.0,
            fixation: 0.9,
            thinning: 0.3,
            tilt: true,
            smoothing: 0.6,
            streamline: 0.5,
            sim: false,
            unknown: Vec::new(),
        }
    }
}

/// Un pennello di uno dei due algoritmi.
#[derive(Clone, Debug, PartialEq)]
pub enum InkBrush {
    Pf1(Brush),
    Nib1(Nib1Brush),
}

impl InkBrush {
    /// Legge un `fub:brush` di `pf1` o di `nib1`, con gli stessi errori.
    pub fn parse(text: &str) -> Result<InkBrush, BrushError> {
        if tokens(text).next() == Some(NIB1) {
            Nib1Brush::parse(text).map(InkBrush::Nib1)
        } else {
            Brush::parse(text).map(InkBrush::Pf1)
        }
    }

    /// Le coppie sconosciute: fra queste, `pen=<id>` dice la penna.
    pub fn unknown(&self) -> &[(String, String)] {
        match self {
            InkBrush::Pf1(brush) => &brush.unknown,
            InkBrush::Nib1(brush) => &brush.unknown,
        }
    }
}

/// Perché un `fub:brush` non si legge: ognuno produce S004.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum BrushError {
    /// Un tratto senza `fub:brush`.
    Missing,
    /// Il pennello non comincia con `pf1` né con `nib1`.
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
            BrushError::Algorithm => f.write_str("fub:brush non comincia con pf1 né con nib1"),
            BrushError::Entry => f.write_str("fub:brush ha una voce senza chiave=valore"),
            BrushError::Repeated(key) => write!(f, "fub:brush ripete {key}"),
            BrushError::Number(key) => write!(f, "{key} di fub:brush non è un numero"),
            BrushError::Range(key) => write!(f, "{key} di fub:brush è fuori dall'intervallo"),
        }
    }
}

impl std::error::Error for BrushError {}

/// Vero se `text` è per intero un numero SVG senza unità: segno facoltativo,
/// cifre con o senza decimali, esponente facoltativo. Come le lunghezze, e come
/// i browser, vuole una cifra dopo il punto: `1.` non è un numero.
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
        match digits(&mut i) {
            0 => return false,
            n => n,
        }
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

/// Le voci di un `fub:brush`, separate da spazi di XML, anche più d'uno.
fn tokens(text: &str) -> impl Iterator<Item = &str> {
    text.split([' ', '\t', '\n', '\r'])
        .filter(|t| !t.is_empty())
}

/// I valori delle chiavi note `keys` e le coppie sconosciute dopo il nome
/// dell'algoritmo; la prima `=` di una voce separa la chiave dal valore.
#[allow(clippy::type_complexity)]
fn entries<'a>(
    tokens: impl Iterator<Item = &'a str>,
    keys: &[&'static str; 9],
) -> Result<([Option<&'a str>; 9], Vec<(String, String)>), BrushError> {
    let mut known: [Option<&str>; 9] = [None; 9];
    let mut unknown = Vec::new();
    for token in tokens {
        let Some((key, value)) = token.split_once('=') else {
            return Err(BrushError::Entry);
        };
        if key.is_empty() || value.is_empty() {
            return Err(BrushError::Entry);
        }
        match keys.iter().position(|&k| k == key) {
            Some(index) => {
                if known[index].replace(value).is_some() {
                    return Err(BrushError::Repeated(keys[index]));
                }
            }
            None => unknown.push((key.to_owned(), value.to_owned())),
        }
    }
    Ok((known, unknown))
}

impl Brush {
    /// Legge un `fub:brush` di `pf1`.
    pub fn parse(text: &str) -> Result<Brush, BrushError> {
        let mut tokens = tokens(text);
        if tokens.next() != Some(PF1) {
            return Err(BrushError::Algorithm);
        }
        let (known, unknown) = entries(tokens, &PF1_KEYS)?;
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

impl Nib1Brush {
    /// Legge un `fub:brush` di `nib1`.
    pub fn parse(text: &str) -> Result<Nib1Brush, BrushError> {
        let mut tokens = tokens(text);
        if tokens.next() != Some(NIB1) {
            return Err(BrushError::Algorithm);
        }
        let (known, unknown) = entries(tokens, &NIB1_KEYS)?;
        let defaults = Nib1Brush::default();
        let value = |index: usize, fallback: f64, min: f64, max: f64| match known[index] {
            Some(text) => in_range(NIB1_KEYS[index], number(NIB1_KEYS[index], text)?, min, max),
            None => Ok(fallback),
        };
        let bit = |index: usize, fallback: bool| match known[index] {
            Some(text) => flag(NIB1_KEYS[index], text),
            None => Ok(fallback),
        };
        let size = match known[0] {
            Some(text) => number("size", text)?,
            None => defaults.size,
        };
        if size <= 0.0 {
            return Err(BrushError::Range("size"));
        }
        Ok(Nib1Brush {
            size,
            tip: value(1, defaults.tip, 0.0, f64::MAX)?,
            angle: value(2, defaults.angle, -180.0, 180.0)?,
            fixation: value(3, defaults.fixation, 0.0, 1.0)?,
            thinning: value(4, defaults.thinning, 0.0, 1.0)?,
            tilt: bit(5, defaults.tilt)?,
            smoothing: value(6, defaults.smoothing, 0.0, 1.0)?,
            streamline: value(7, defaults.streamline, 0.0, 1.0)?,
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
        for valid in ["0", "-1", "+2", ".5", "1.5", "1e3", "1E-3", "-.5e+2", "007"] {
            assert!(is_number(valid), "{valid}");
        }
        for invalid in [
            "", ".", "1.", "-1.e3", "+", "e3", "1e", "1e+", "0x10", "Infinity", "NaN", "1px", " 1",
            "1 ", "1..2",
        ] {
            assert!(!is_number(invalid), "{invalid}");
        }
    }
}
