//! Poligoni regolari e stelle, le forme sintetiche coi parametri (formato
//! della scena, §6): un `path` con `fub:shape` `polygon` o `star` e
//! `fub:geom`, che porta il centro, il raggio, i lati o le punte, il rapporto
//! interno di una stella, la rotazione e il raggio degli angoli.
//!
//! È la lettura di `parametric.ts` della superficie, regola per regola: i casi
//! scritti a mano in `apps/client/src/__fixtures__/scene-shapes/cases.json`
//! valgono per tutte e due. Il `d` lo calcola la superficie, come per la
//! freccia; qui basta sapere se la geometria si legge. Un `fub:geom` fuori
//! dalla grammatica lascia un tracciato qualunque, che si legge da `d`.

use serde::Serialize;

use crate::values::number_list;

/// Quanti lati, o punte, al meno.
pub const MIN_COUNT: u32 = 3;
/// Quanti lati, o punte, al più.
pub const MAX_COUNT: u32 = 1000;

/// Il valore di `fub:shape` di un poligono regolare e di una stella.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PolygonalShape {
    Polygon,
    Star,
}

impl PolygonalShape {
    /// La forma scritta in `fub:shape`, se è una di queste due.
    pub fn parse(value: &str) -> Option<PolygonalShape> {
        match value {
            "polygon" => Some(PolygonalShape::Polygon),
            "star" => Some(PolygonalShape::Star),
            _ => None,
        }
    }
}

/// Un poligono regolare o una stella, come li porta `fub:geom`.
#[derive(Copy, Clone, Debug, PartialEq, Serialize)]
pub struct Polygonal {
    pub shape: PolygonalShape,
    pub cx: f64,
    pub cy: f64,
    /// Il raggio del cerchio dei vertici, o delle punte.
    pub r: f64,
    /// I lati di un poligono, le punte di una stella.
    pub count: u32,
    /// Il rapporto fra il raggio dei vertici interni e quello delle punte, di
    /// una stella; `None` per un poligono.
    pub ratio: Option<f64>,
    /// Gradi, in senso orario.
    pub rotation: f64,
    /// Il raggio degli angoli; 0 li lascia vivi.
    pub corner: f64,
}

/// I lati o le punte, se `value` è un intero da [`MIN_COUNT`] a
/// [`MAX_COUNT`]; anche scritto `4.0`.
fn count(value: f64) -> Option<u32> {
    (value.fract() == 0.0 && (f64::from(MIN_COUNT)..=f64::from(MAX_COUNT)).contains(&value))
        .then_some(value as u32)
}

/// La geometria di un `path` con `fub:shape` `shape` e `fub:geom` `geom`;
/// `None` se `geom` è fuori dalla grammatica: un numero di valori diverso, un
/// raggio che non è positivo, lati che non sono un intero da 3 a 1000, un
/// rapporto fuori da (0, 1] o un raggio degli angoli negativo.
pub fn read_polygonal(shape: PolygonalShape, geom: &str) -> Option<Polygonal> {
    let numbers = number_list(geom)?;
    let (cx, cy, r, n, ratio, rotation, corner) = match (shape, numbers.as_slice()) {
        (PolygonalShape::Polygon, &[cx, cy, r, n, rotation, corner]) => {
            (cx, cy, r, n, None, rotation, corner)
        }
        (PolygonalShape::Star, &[cx, cy, r, n, ratio, rotation, corner]) => {
            if !(ratio > 0.0 && ratio <= 1.0) {
                return None;
            }
            (cx, cy, r, n, Some(ratio), rotation, corner)
        }
        _ => return None,
    };
    if !(r > 0.0 && corner >= 0.0) {
        return None;
    }
    Some(Polygonal {
        shape,
        cx,
        cy,
        r,
        count: count(n)?,
        ratio,
        rotation,
        corner,
    })
}
