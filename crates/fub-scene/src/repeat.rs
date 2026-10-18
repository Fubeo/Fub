//! Le ripetizioni (formato della scena, ripetizioni): un gruppo con
//! `fub:repeat` mostra più volte un oggetto, l'originale, intorno a un
//! centro, su una griglia o allo specchio. Le copie sono `use` fratelli
//! dell'originale, ciascuno con la sua `transform`, che si legge dal file come
//! quella di ogni altro oggetto: qui basta sapere se il gruppo è una
//! ripetizione, e quale.
//!
//! È la lettura di `repeat.ts` della superficie, regola per regola: i casi
//! scritti a mano in `apps/client/src/__fixtures__/scene-repeat/cases.json`
//! valgono per tutte e due. Le trasformazioni delle copie le calcola la
//! superficie quando la ripetizione cambia; un `fub:repeat` fuori dalla
//! grammatica lascia un gruppo qualunque, e le sue copie restano `use`
//! estranei.

use serde::Serialize;

use crate::values::{is_wsp, number};

/// Quante volte al più una ripetizione radiale mostra l'originale, lui
/// compreso.
pub const MAX_RADIAL: u32 = 100;

/// Quante colonne, e quante righe, ha al più una griglia.
pub const MAX_GRID_SIDE: u32 = 100;

/// Quante volte al più una griglia mostra l'originale, lui compreso.
pub const MAX_GRID: u32 = 1000;

/// Una ripetizione letta: radiale, l'originale `count` volte intorno a
/// `center`; a griglia, `columns` × `rows` volte, spostato di `step` per
/// colonna e per riga; allo specchio, l'originale e la sua immagine riflessa
/// sulla retta per i due punti di `axis`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Repeat {
    Radial {
        count: u32,
        center: [f64; 2],
    },
    Grid {
        columns: u32,
        rows: u32,
        step: [f64; 2],
    },
    Mirror {
        axis: [[f64; 2]; 2],
    },
}

impl Repeat {
    /// Quante copie ha la ripetizione, l'originale escluso.
    pub fn copies(&self) -> u32 {
        match self {
            Repeat::Radial { count, .. } => count - 1,
            Repeat::Grid { columns, rows, .. } => columns * rows - 1,
            Repeat::Mirror { .. } => 1,
        }
    }
}

fn is_space(c: char) -> bool {
    c.is_ascii() && is_wsp(c as u8)
}

/// Un conto: cifre e basta, fra `least` e `most`.
fn count(word: &str, least: u32, most: u32) -> Option<u32> {
    if word.is_empty() || !word.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    // Troppe cifre per un `u32` sono comunque oltre ogni limite.
    word.parse::<u32>()
        .ok()
        .filter(|value| (least..=most).contains(value))
}

/// Un numero finito, la parola intera.
fn coordinate(word: &str) -> Option<f64> {
    number(word).filter(|value| value.is_finite())
}

/// La forma di `fub:repeat`; `None` fuori dalla grammatica: il tipo scritto
/// esatto, minuscolo, e dopo, separati da spazi, `radial <volte> <cx> <cy>`
/// con le volte da 2 a [`MAX_RADIAL`]; `grid <colonne> <righe> <dx> <dy>` con
/// colonne e righe da 1 a [`MAX_GRID_SIDE`] e il loro prodotto da 2 a
/// [`MAX_GRID`]; `mirror <x1> <y1> <x2> <y2>` con i due punti diversi. I
/// conti sono cifre, i numeri quelli di SVG.
pub fn read_repeat(value: &str) -> Option<Repeat> {
    let words: Vec<&str> = value.split(is_space).filter(|w| !w.is_empty()).collect();
    let (kind, rest) = words.split_first()?;
    match (*kind, rest) {
        ("radial", [times, cx, cy]) => Some(Repeat::Radial {
            count: count(times, 2, MAX_RADIAL)?,
            center: [coordinate(cx)?, coordinate(cy)?],
        }),
        ("grid", [columns, rows, dx, dy]) => {
            let columns = count(columns, 1, MAX_GRID_SIDE)?;
            let rows = count(rows, 1, MAX_GRID_SIDE)?;
            let step = [coordinate(dx)?, coordinate(dy)?];
            let total = columns * rows;
            (2..=MAX_GRID).contains(&total).then_some(Repeat::Grid {
                columns,
                rows,
                step,
            })
        }
        ("mirror", [x1, y1, x2, y2]) => {
            let from = [coordinate(x1)?, coordinate(y1)?];
            let to = [coordinate(x2)?, coordinate(y2)?];
            (from != to).then_some(Repeat::Mirror { axis: [from, to] })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_copie_si_contano_senza_l_originale() {
        let radial = read_repeat("radial 8 0 0").unwrap();
        let grid = read_repeat("grid 40 25 1 1").unwrap();
        let mirror = read_repeat("mirror 0 0 0 1").unwrap();
        assert_eq!(
            [radial.copies(), grid.copies(), mirror.copies()],
            [7, 999, 1]
        );
    }

    #[test]
    fn i_limiti_sono_quelli_del_formato() {
        assert!(read_repeat(&format!("radial {MAX_RADIAL} 0 0")).is_some());
        assert!(read_repeat(&format!("radial {} 0 0", MAX_RADIAL + 1)).is_none());
        assert!(read_repeat(&format!("grid {MAX_GRID_SIDE} 10 1 1")).is_some());
        assert!(read_repeat(&format!("grid {} 1 1 1", MAX_GRID_SIDE + 1)).is_none());
        assert!(read_repeat("grid 40 26 1 1").is_none());
    }
}
