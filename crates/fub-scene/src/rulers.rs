//! L'unità e le guide del documento, due attributi della radice (formato della
//! scena, unità e guide): `fub:units` dice in che unità la superficie scrive
//! misure e posizioni, `fub:guides` porta le guide tirate dai righelli. Nessuno
//! dei due cambia il disegno, e gli altri programmi li ignorano.
//!
//! È `rulers.ts` della superficie, regola per regola: i casi scritti a mano in
//! `apps/client/src/__fixtures__/scene-rulers/cases.json` valgono per tutte e
//! due le letture. Un valore fuori grammatica non si usa e resta nel file com'è
//! (S011).

use serde::Serialize;

use crate::values::{is_wsp, number};

/// L'unità del documento. Il file resta in unità utente: l'unità cambia
/// soltanto come la superficie scrive i numeri.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    Px,
    Mm,
    Cm,
    In,
    Pt,
}

impl Unit {
    /// L'unità scritta in `fub:units`, oppure `None` se il valore non è una
    /// delle cinque, scritta così.
    pub fn parse(value: &str) -> Option<Unit> {
        match value {
            "px" => Some(Unit::Px),
            "mm" => Some(Unit::Mm),
            "cm" => Some(Unit::Cm),
            "in" => Some(Unit::In),
            "pt" => Some(Unit::Pt),
            _ => None,
        }
    }

    /// Quante unità utente vale: 96 per pollice, come in CSS.
    pub fn size(self) -> f64 {
        match self {
            Unit::Px => 1.0,
            Unit::Mm => 96.0 / 25.4,
            Unit::Cm => 96.0 / 2.54,
            Unit::In => 96.0,
            Unit::Pt => 96.0 / 72.0,
        }
    }
}

/// Le guide di un documento, al più.
pub const MAX_GUIDES: usize = 1000;

/// La direzione di una guida, dalla coordinata che fissa.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    /// Una retta verticale, alla coordinata x della radice.
    X,
    /// Una retta orizzontale, alla coordinata y della radice.
    Y,
}

/// Una guida. Una guida bloccata non si trascina.
#[derive(Copy, Clone, Debug, PartialEq, Serialize)]
pub struct Guide {
    pub axis: Axis,
    pub at: f64,
    pub locked: bool,
}

/// Le parti di una voce, separate dagli spazi di SVG.
fn words(entry: &str) -> impl Iterator<Item = &str> {
    entry
        .split(|c: char| c.is_ascii() && is_wsp(c as u8))
        .filter(|word| !word.is_empty())
}

/// Le guide scritte in `fub:guides`, nell'ordine del file, oppure `None` se il
/// valore è fuori grammatica o ne porta più di [`MAX_GUIDES`]. Un valore vuoto,
/// o di soli spazi, non ha guide.
pub fn parse_guides(value: &str) -> Option<Vec<Guide>> {
    if words(value).next().is_none() {
        return Some(Vec::new());
    }
    let entries: Vec<&str> = value.split(';').collect();
    if entries.len() > MAX_GUIDES {
        return None;
    }
    let mut guides = Vec::with_capacity(entries.len());
    for entry in entries {
        let parts: Vec<&str> = words(entry).collect();
        let (axis, at, flag) = match parts[..] {
            [axis, at] => (axis, at, None),
            [axis, at, flag] => (axis, at, Some(flag)),
            _ => return None,
        };
        let axis = match axis {
            "x" => Axis::X,
            "y" => Axis::Y,
            _ => return None,
        };
        let at = number(at)?;
        if flag.is_some_and(|flag| flag != "locked") {
            return None;
        }
        // `-0` è `0`: una guida non ha segno.
        guides.push(Guide {
            axis,
            at: at + 0.0,
            locked: flag.is_some(),
        });
    }
    Some(guides)
}
